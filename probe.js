function send(recv, ...rest) { return recv; }
let name = "Joel";
let greet = send(name, 'greeting');
let msg = send(greet, 'value:', "world");
send(console, 'log:', msg);
//# sourceMappingURL=probe.js.map