const CARRY_MASK = 0x1;
const SUBTRACT_MASK = 0x2;
const OVERFLOW_MASK = 0x4;
const UNDOC3_MASK = 0x8;
const HALF_CARRY_MASK = 0x10;
const UNDOC5_MASK = 0x20;
const ZERO_MASK = 0x40;
const	SIGN_MASK = 0x80;

class TrsXray {
  private socket: WebSocket;

  private onMessageFromEmulator(json: IDataFromEmulator): void {
    console.log(json);
    this.onRegisterUpdate(json.registers);
  }

  private onControl(action: string): void {
    if (this.socket != undefined) this.socket.send("action/" + action);
  }

  public onLoad(): void {
    $('input:text').keydown(function(e){e.stopPropagation();});
    document.addEventListener("keydown", (evt) => {
      switch (evt.key) {
        case 't':
          this.debug_insertTestData();
          break;
        default:
          console.log(`Unhandled key event: ${evt.key}`);
      }
    });
    this.socket = new WebSocket("ws://" + location.host + "/channel");
    this.socket.onerror = (evt) => {
      console.log("Unable to connect to websocket.");
      $("h1").addClass("errorTitle");
    };
    // socket.onopen = () => TODO: Show connection successful message
    this.socket.onmessage = (evt) =>  {
      var json = JSON.parse(evt.data);
      this.onMessageFromEmulator(json);
    };
    $("#step-btn").on("click", () => { this.onControl("step") });
    $("#step-over-btn").on("click", () => { this.onControl("step-over") });
    $("#play-btn").on("click", () => { this.onControl("continue") });
    $("#reset-btn").on("click", (ev) => { 
      this.onControl(ev.shiftKey ? "hard_reset" : "soft_reset")
    });
  }

  private onRegisterUpdate(registers): void {
    /* Main registers. */
    let a = (registers.af & 0xFF00) >> 8;
    let f = (registers.af & 0x00FF);
    let b = (registers.bc & 0xFF00) >> 8;
    let c = (registers.bc & 0x00FF);
    let d = (registers.de & 0xFF00) >> 8;
    let e = (registers.de & 0x00FF);
    let h = (registers.hl & 0xFF00) >> 8;
    let l = (registers.hl & 0x00FF);

    /* Alternate registers. */
    let ap = (registers.af_prime & 0xFF00) >> 8;
    let fp = (registers.af_prime & 0x00FF);
    let bp = (registers.bc_prime & 0xFF00) >> 8;
    let cp = (registers.bc_prime & 0x00FF);
    let dp = (registers.de_prime & 0xFF00) >> 8;
    let ep = (registers.de_prime & 0x00FF);
    let hp = (registers.hl_prime & 0xFF00) >> 8;
    let lp = (registers.hl_prime & 0x00FF);

    /* Index registers. */
    let ix1 = (registers.ix & 0xFF00) >> 8;
    let ix2 = (registers.ix & 0x00FF);
    let iy1 = (registers.iy & 0xFF00) >> 8;
    let iy2 = (registers.iy & 0x00FF);
    let sp1 = (registers.sp & 0xFF00) >> 8;
    let sp2 = (registers.sp & 0x00FF);

    /* Program counter. */
    let pc1 = (registers.pc & 0xFF00) >> 8;
    let pc2 = (registers.pc & 0x00FF);

    /** Extract flag values from 'f' register. */
    let flag_sign	=	f & SIGN_MASK;
    let flag_zero = f & ZERO_MASK;
    let flag_undoc5 = f & UNDOC5_MASK;
    let flag_half_carry = f & HALF_CARRY_MASK;
    let flag_undoc3 = f & UNDOC3_MASK;
    let flag_overflow = f & OVERFLOW_MASK;
    let flag_subtract = f & SUBTRACT_MASK;
    let flag_carry = f & CARRY_MASK;

    const numToHex = (num: number) => (num <= 0xF ? "0" : "") + num.toString(16);

    $("#reg-af-1").val(numToHex(a));
    $("#reg-af-2").val(numToHex(f));
    $("#reg-bc-1").val(numToHex(b));
    $("#reg-bc-2").val(numToHex(c));
    $("#reg-de-1").val(numToHex(d));
    $("#reg-de-2").val(numToHex(e));
    $("#reg-hl-1").val(numToHex(h));
    $("#reg-hl-2").val(numToHex(l));

    $("#reg-afp-1").val(numToHex(ap));
    $("#reg-afp-2").val(numToHex(fp));
    $("#reg-bcp-1").val(numToHex(bp));
    $("#reg-bcp-2").val(numToHex(cp));
    $("#reg-dep-1").val(numToHex(dp));
    $("#reg-dep-2").val(numToHex(ep));
    $("#reg-hlp-1").val(numToHex(hp));
    $("#reg-hlp-2").val(numToHex(lp));

    $("#reg-ix-1").val(numToHex(ix1));
    $("#reg-ix-2").val(numToHex(ix2));
    $("#reg-iy-1").val(numToHex(iy1));
    $("#reg-iy-2").val(numToHex(iy2));
    $("#reg-sp-1").val(numToHex(sp1));
    $("#reg-sp-2").val(numToHex(sp2));

    $("#reg-pc-1").val(numToHex(pc1));
    $("#reg-pc-2").val(numToHex(pc2));

    /* Fun with Flags */
    let setFlag = (id: string, value: number) => {
      if (value) {
        $(id).addClass("flag-enabled");
      } else {
        $(id).removeClass("flag-enabled");
      }
    };

    setFlag("#flag-s",  flag_sign);
    setFlag("#flag-z",  flag_zero);
    setFlag("#flag-u5", flag_undoc5);
    setFlag("#flag-h",  flag_half_carry);
    setFlag("#flag-u3", flag_undoc3);
    setFlag("#flag-pv", flag_overflow);
    setFlag("#flag-n",  flag_subtract);
    setFlag("#flag-c",  flag_carry);
  }

  private debug_insertTestData(): void {
    console.log("Inserting test data for debugging...");
    const data: IDataFromEmulator = {"context":{"system_name":"sdlTRS","model":3},"registers":{"pc":1,"sp":65535,"af":65535,"bc":0,"de":0,"hl":0,"af_prime":0,"bc_prime":0,"de_prime":0,"hl_prime":0,"ix":0,"iy":0,"i":0,"r_1":0,"r_2":1,"z80_t_state_counter":4,"z80_clockspeed":2.0299999713897705,"z80_iff1":0,"z80_iff2":0,"z80_interrupt_mode":0,"flag_sign":1,"flag_zero":1,"flag_undoc5":1,"flag_half_carry":1,"flag_undoc3":1,"flag_overflow":1,"flag_subtract":1,"flag_carry":1}};
    this.onMessageFromEmulator(data);
  }
}

interface ISUT_Context {
  system_name: string;
  model: number;
}

interface ISUT_Registers {
  ix: number,
  iy: number,
  pc: number,
  sp: number,
  af: number,
  bc: number,
  de: number,
  hl: number,
  af_prime: number,
  bc_prime: number,
  de_prime: number,
  hl_prime: number,
  i: number,
  r_1: number,
  r_2: number,

  z80_t_state_counter: number,
  z80_clockspeed: number,
  z80_iff1: number,
  z80_iff2: number,
  z80_interrupt_mode: number,

  flag_sign: number,
  flag_zero: number,
  flag_undoc5: number,
  flag_half_carry: number,
  flag_undoc3: number,
  flag_overflow: number,
  flag_subtract: number,
  flag_carry: number,
}

interface IDataFromEmulator {
  context: ISUT_Context,
  registers: ISUT_Registers
}