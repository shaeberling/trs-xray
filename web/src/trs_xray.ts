declare function isDebugMode(): boolean;


import { RegisterPanel } from "./register_panel"
import { ISUT_Context, ISUT_Registers, ISUT_Breakpoint, TRS80GP_Import } from "./data_structures";
import { numToHex } from "./utils";
import { Screen } from "./screen";
import { MemoryView } from "./memory_view";
import { MemoryRegions } from "./memory_regions";
import { Disassembler } from "./disassembler";

// See web_debugger.h for definitions.
const BP_TYPE_TEXT = ["Program Counter", "Memory Watch", "IO Watch"];

class TrsXray {
  private socket: WebSocket | null = null;

  private altSingleStepMode: boolean;
  private emulatorIsRunning: boolean;

  private memoryData: Uint8Array;
  private memoryChanged: Uint8Array;
  private selectedByte: number;

  private memoryView: MemoryView;
  private screenView: Screen;
  private registersView: RegisterPanel;
  private disassembler: Disassembler;

  // If false, only screen and registers are updated.
  private enableFullMemoryUpdate: boolean;

  private sutHostname: string;

  constructor() {
    this.altSingleStepMode = false;
    this.emulatorIsRunning = false;

    this.memoryData = new Uint8Array(0xFFFF);
    this.memoryChanged = new Uint8Array(0xFFFF);
    this.selectedByte = -1;

    this.memoryView = new MemoryView("memory-container",
                                     this.memoryData,
                                     this.memoryChanged,
                                     (sel) => this.onSelectionUpdate(sel));
    this.screenView = new Screen("screen");
    this.registersView = new RegisterPanel();
    this.disassembler = new Disassembler("disassembler");

    this.enableFullMemoryUpdate = true;
    this.sutHostname = "N/A";
  }

  private writeMem(addr: number, value: number): void {
    this.onControl(`set_memory/${addr}/${value}`);
  }

  private createMemoryRegions(): void {
    const regions = MemoryRegions.getMemoryRegions();
    const container = $("#memory-regions");
    regions.map((region, idx) => {
      $("<div></div>")
          .addClass("map-region-list-entry")
          .text(region.description)
          .on("mouseover", () => {this.memoryView.onMemoryRegionSelect(idx)})
          .appendTo(container);
    });
  }

  private onMessageFromEmulator(json: IDataFromEmulator): void {
    if (json.context) this.onContextUpdate(json.context);
    if (json.breakpoints) this.onBreakpointUpdate(json.breakpoints);
    if (json.registers) this.onRegisterUpdate(json.registers);
  }

  private onControl(action: string): void {
    if (this.socket != undefined) this.socket.send("action/" + action);
  }

  private requestMemoryUpdate(): void {
    if (this.enableFullMemoryUpdate) {
      this.onControl("get_memory/0/65536");
    } else {
      this.onControl(`get_memory/${0x3C00}/${0x3FFF-0x3C00}`);
    }
  }

  /** Key pressed that is to be send to SUT. */
  private onKeyPressForSut(direction: string, evt: KeyboardEvent): void {
    evt.preventDefault();
    if (evt.repeat) return;

    let shift = evt.shiftKey ? "1" : "0";
    let dir = direction == "down" ? "1" : "0";
    this.onControl(`key_event/${dir}/${shift}/${evt.key}`);
  }

  private onControlStep(): void {
    if (this.emulatorIsRunning) return;

    console.log("altSingleStepMode: " + this.altSingleStepMode);
    if (!this.altSingleStepMode) {
      this.onControl("step");
      this.requestMemoryUpdate();
    } else {
      // TODO: Only remove synthetic breakpoints.
      this.onControl("clear_breakpoints");

      // In alt mode we predict where the next instruction is and set
      // breakpoints there to simulate single stepping.
      const nextPCs = this.disassembler.predictNextPC();
      for (var addr of nextPCs) {
        // Add synthetic PC breakpoint.
        this.onControl(`add_breakpoint/pc/${addr}`);
      }
      this.onControl("continue");
    }
  }

  public onLoad(): void {
    $('input:text').on("keydown", (evt) => {evt.stopPropagation();});
    $('textarea').on("keydown", (evt) => {evt.stopPropagation();});
    document.addEventListener("keydown", (evt) => {
      if (this.screenView.isMouseOnScreen()) this.onKeyPressForSut("down", evt);
      else {
        switch (evt.key) {
          case '1':
            this.onControlStep();
            break;
          case '2':
            this.onControl("continue");
            this.requestMemoryUpdate();
            break;
          case '3':
            this.onControl("stop");
            this.requestMemoryUpdate();
            break;
          case '4':
            this.onControl("soft_reset")
            this.requestMemoryUpdate();
            break;
          case '$': // Shift-4
            this.onControl("hard_reset")
            this.requestMemoryUpdate();
            break;
          case '+':
          case '=':
            this.memoryView.increaseByteSize();
            break;
          case '-':
            this.memoryView.decreaseByteSize();
            break;
          case 't':
            this.debug_insertTestData();
            break;
          case 'd':
            this.memoryView.toggleDataViz();
            break;
          case 'e':
            this.memoryView.toggleLineViz();
            break;
          case 'z':
            this.updateDisassembly();
            break;
          case 'M':
            this.toggleVisibility("memory-regions-section");
            break;
          case 'S':
            this.toggleVisibility("screen-section");
            break;
          case 'm':
            this.enableFullMemoryUpdate = !this.enableFullMemoryUpdate;
            break;
          case 'r':
            this.forceRefresh();
            break;
          case 'I':
            this.openImportDialog();
            break;
          case 'I':
            this.onControl("inject_demo");
            break;
          default:
          console.log(`Unhandled key event: ${evt.key}`);
        }
      }
    });
    document.addEventListener("keyup", (evt) => {
      if (this.screenView.isMouseOnScreen()) this.onKeyPressForSut("up", evt);
    });

    $("#step-btn").on("click", () => {
      this.onControlStep();
    });
    $("#play-btn").on("click", () => { this.onControl("continue") });
    $("#stop-btn").on("click", () => { this.onControl("stop") });
    $("#reset-btn").on("click", (ev) => {
      this.onControl(ev.shiftKey ? "hard_reset" : "soft_reset")
    });

    const addBreakpointHandler = (ev: JQuery.ClickEvent) => {
      const type = $(ev.currentTarget).attr("data");
      console.log(`Click data: ${ev.currentTarget} -> ${type}`);
      const addr = this.getSelectionFromTextfields();
      console.log(`Add breakpoint for: ${numToHex(addr)}(${addr})`);

      if (addr == NaN) {
        alert("Invalid address");
        return;
      }
      this.onControl(`add_breakpoint/${type}/${addr}`)
    };
    $("#selected-val").on("keyup", (evt) => {
      if (evt.key == "Enter") {
        const valStr = $("#selected-val").val() as string;
        const value = parseInt(valStr, 16);
        if (value != NaN) {
          this.writeMem(this.selectedByte, value);
        } else {
          console.error(`Cannot parse value: '${valStr}'`);
        }
      }
    });
    $("#selected-addr-1").on("focusout", (evt) => {
      this.updateSelectionFromTextField();
    });
    $("#selected-addr-2").on("focusout", (evt) => {
      this.updateSelectionFromTextField();
    });
    $("#add-breakpoint-pc").on("click", addBreakpointHandler);
    $("#add-breakpoint-memory").on("click", addBreakpointHandler);

    this.createMemoryRegions();
    this.toggleVisibility("memory-regions-section");  // Hide by default.

    $("#import-btn").on("click", () => {
      this.importTrs80Gp($("#import-content").val() as string);
    });


    const IP_PARAM = "?ip=";
    const CONNECT_PARAM = "?connect=";
    var params = window.location.search;

    if (params && params.startsWith(IP_PARAM)) {
      alert("Parameter changed: Please use connect= instead of ip=");
      return;
    }
    if (params && params.startsWith(CONNECT_PARAM)) {
      this.sutHostname = params.substr(CONNECT_PARAM.length);
      console.log(`SUT hostname: ${this.sutHostname}`);
    } else {
      this.sutHostname = "";
      this.openImportDialog();
    }

    // Keep at the end of onLoad().
    if (!isDebugMode()) this.keepConnectionAliveLoop();
  }

  private importTrs80Gp(jsonStr: string): void {
    try {
      // trs80gp is not well-defined JSON, so keys need to be quoted.
      var fixedJsonStr = jsonStr.replace(/(['"])?([a-z0-9A-Z_]+)(['"])?:/g, '"$2": ');
      const json = JSON.parse(fixedJsonStr) as TRS80GP_Import;

      const ctx : ISUT_Context = {
        system_name: "trs80gp-import",
        model: 0,
        running: false,
        alt_single_step_mode: false
      };
      this.onContextUpdate(ctx);
      const registers: ISUT_Registers = {
        af: json.AF,
        af_prime: json.AFp,
        bc: json.BC,
        bc_prime: json.BCp,
        de: json.DE,
        de_prime: json.DEp,
        hl: json.HL,
        hl_prime: json.HLp,

        i: json.I,
        z80_iff1: json.IFF1,
        z80_iff2: json.IFF2,
        ix: json.IX,
        iy: json.IY,
        pc: json.PC,
        sp: json.SP,
        r_1: json.R,
        r_2: 0, // FIXME. Split json.R?
        z80_clockspeed: 0,
        z80_interrupt_mode: 0,
        z80_t_state_counter: 0
      }
      this.onRegisterUpdate(registers);
      // Add start address information.
      const memory = Uint8Array.from([0, 0].concat(json.mem));
      // Doing this twice to discard modified markers.
      this.onMemoryUpdate(memory);
      this.onMemoryUpdate(memory);

      // For this mode, switch viz.
      this.memoryView.toggleDataViz();

      // Hide import dialog is parsing was successful.
      $("#import-overlay").toggle();
    } catch(e) {
      alert("Failed to import trs80gp JSON");
      console.error(e);
    }
  }

  private openImportDialog(): void {
    $("#import-overlay").css("display", "grid");
  }

  private forceRefresh(): void {
    this.onControl("refresh");
    this.onControl("get_memory/force_update");
  }

  private updateSelectionFromTextField(): void {
    const newSelection = this.getSelectionFromTextfields();
    if (newSelection != NaN) {
      this.onSelectionUpdate(newSelection);
      this.memoryView.onSelectedByteChanged(this.selectedByte);
    }
  }

  private getSelectionFromTextfields(): number {
    const addr1 = $("#selected-addr-1").val() as string;
    const addr2 = $("#selected-addr-2").val() as string;
    if (!addr1 || addr1.length != 2 || !addr2 || addr2.length != 2) {
      return NaN;
    }
    return parseInt(`${addr1}${addr2}`, 16);
  }


  private updateDisassembly(): void {
    // For performance reasons, trim down disassembly area as much as possible.
    var endAddr = 0xFFFE;
    for (; endAddr >= 0; --endAddr) {
      if  (this.memoryData[endAddr] != 0) break;
    }
    const typeData = this.disassembler.disassemble(this.memoryData.slice(0, endAddr + 1));
    this.memoryView.onMemoryTypeUpdate(typeData);
  }

  private toggleVisibility(elementId: string): void {
    $(`#${elementId}`).toggle();
  }

  private keepConnectionAliveLoop() {
    if (!this.socket || this.socket.readyState != WebSocket.OPEN) {
      $("h1").addClass("errorTitle");
      if (!this.socket ||
          this.socket.readyState == WebSocket.CLOSED ||
          this.socket.readyState == WebSocket.CLOSING) {
        this.createNewSocket();
      }
      setTimeout(() => this.keepConnectionAliveLoop(), 200);
    } else {
      $("h1").removeClass("errorTitle");
      setTimeout(() => this.keepConnectionAliveLoop(), 500);
    }
  }

  private createNewSocket() {
    console.log("Creating new Websocket");
    // FIXME: Make this a URL parameter!
    this.socket = new WebSocket(`ws://${this.sutHostname}/channel`);
    this.socket.onerror = (evt) => {
      console.log("Unable to connect to websocket.");
      $("h1").addClass("errorTitle");
    };
    this.socket.onopen = () => {
      console.log("Socked opened.");
      this.forceRefresh();
    }
    this.socket.onmessage = (evt) =>  {
      if (evt.data instanceof Blob) {
        evt.data.arrayBuffer().then((data) => {
          this.onMemoryUpdate(new Uint8Array(data));
        });
      } else {
        var json = JSON.parse(evt.data);
        this.onMessageFromEmulator(json);
        this.memoryView.renderMemoryRegions();
      }
    };
  }

  private onContextUpdate(ctx: ISUT_Context): void {
    $("#sut-name").text(ctx.system_name);
    $("#sut-model-no").text(`M${ctx.model}`);
    $("#play-btn").css("color", ctx.running ? "#0D0" : "red");
    $("#step-btn").css("color", !ctx.alt_single_step_mode ? "#0D0" : "orange");
    this.emulatorIsRunning = ctx.running;
    this.altSingleStepMode = ctx.alt_single_step_mode;
  }

  private onRegisterUpdate(registers: ISUT_Registers): void {
    this.registersView.update(registers);
    this.memoryView.onRegisterUpdate(registers.pc, registers.sp)
    this.disassembler.updatePC(registers.pc);
    this.updateDisassembly();
  }

  lastBreakpoints = Array<ISUT_Breakpoint>(0);
  private onBreakpointUpdate(breakpoints: Array<ISUT_Breakpoint>): void {
    if (JSON.stringify(this.lastBreakpoints) == JSON.stringify(breakpoints)) return;

    this.lastBreakpoints = breakpoints;
    $("#breakpoints").empty();
    for (var bp of breakpoints) {
      let r1 = numToHex((bp.address & 0xFF00) >> 8);
      let r2 = numToHex((bp.address & 0x00FF));
      $(`<div class="register">${r1}</div>`).appendTo("#breakpoints");
      $(`<div class="register">${r2}</div>`).appendTo("#breakpoints");
      $(`<div class="breakpoint-type">${BP_TYPE_TEXT[bp.type]}</div>`)
          .on("click", (evt) => {
            $("#selected-addr-1").val(r1);
            $("#selected-addr-2").val(r2);
            this.updateSelectionFromTextField();
          })
          .appendTo("#breakpoints");
      $(`<div class="remove-breakpoint" data="${bp.id}"></div>`)
          .on("click", (evt) => {
            const id = $(evt.currentTarget).attr("data");
            this.onControl(`remove_breakpoint/${id}`);
          })
          .appendTo("#breakpoints");
    }
  }

  private onMemoryUpdate(memory: Uint8Array): void {
    // The first two bytes are the start offset address.
    let startAddr = (memory[0] << 8) + memory[1];
    for (let i = 2; i < memory.length; ++i) {
      let addr = startAddr + i - 2;
      if (this.memoryData[addr] != memory[i]) {
        this.memoryChanged[addr] = 1;
        this.memoryData[addr] = memory[i];
      } else {
        this.memoryChanged[addr] = 0;
      }
    }
    this.onSelectionUpdate(-1);
    this.screenView.render(this.memoryData);
    this.memoryView.renderMemoryRegions();
    this.updateDisassembly();
  }

  private onSelectionUpdate(addr: number): void {
    if (addr >= 0) {
      this.selectedByte = addr;
    }

    let hi = (this.selectedByte & 0xFF00) >> 8;
    let lo = (this.selectedByte & 0x00FF);
    $("#selected-addr-1").val(numToHex(hi));
    $("#selected-addr-2").val(numToHex(lo));
    if (this.memoryData && this.selectedByte >= 0) {
      $("#selected-val").val(numToHex(this.memoryData[this.selectedByte]));
    }
  }

  private debug_insertTestData(): void {
    console.log("Inserting test data for debugging...");
    const data: IDataFromEmulator = {"context":{"system_name":"sdlTRS","model":3, "running":true, "alt_single_step_mode": false},"breakpoints":[{"id":0,"address":4656,"type":0},{"id":1,"address":6163,"type":0},{"id":2,"address":9545,"type":0}],"registers":{"pc":2,"sp":65535,"af":68,"bc":0,"de":0,"hl":0,"af_prime":0,"bc_prime":0,"de_prime":0,"hl_prime":0,"ix":0,"iy":0,"i":0,"r_1":0,"r_2":2,"z80_t_state_counter":8,"z80_clockspeed":2.0299999713897705,"z80_iff1":0,"z80_iff2":0,"z80_interrupt_mode":0}};
    this.onMessageFromEmulator(data);
  }
}

interface IDataFromEmulator {
  context: ISUT_Context,
  breakpoints: Array<ISUT_Breakpoint>,
  registers: ISUT_Registers
}

// Hook up our code to site onload event.
// Note: This is important to add as an entry point as webpack would otherwise
//       remove most of our code as it appears unused.
window.onload = () => {new TrsXray().onLoad()};
console.log("Hooking up window.onload");