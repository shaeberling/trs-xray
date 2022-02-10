# trs-xray
TRS-X-ray is a system-agnostic debugger frontend and protocol for TRS-80 systems and emulators.

# Setup

Install npm and all dependencies.
```
cd web
npm install -g npm@7.20.6
npm install
```

Compile TypeScript and pack
```
tsc && npx webpack
```

Add HTML and CSS files
```
cp src/*.html dist/webpack/
cp src/*.css dist/webpack
```

Launch local webserver
```
cd dist/webpack
python3 -m http.server
```

Point your web browser to `http://localhost:8000/connect=<ip address>`