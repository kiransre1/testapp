import { describeConfig, loadServerEnv } from "@testapp/core";

const env = loadServerEnv();
console.log(JSON.stringify({ msg: "worker starting", config: describeConfig(env) }));
