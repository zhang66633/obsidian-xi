/*
 * 希XI 版本号同步脚本（npm version 生命周期）
 *
 * 背景：0.4.x 时期 package.json 停在 0.1.0、manifest 已到 0.4.2——三处版本号各自漂移，
 * 发布时容易打错 tag。这里让 npm version 成为唯一入口：
 *   npm version 0.5.0 --no-git-tag-version
 * 会先写 package.json / package-lock.json，再触发本脚本写 manifest.json 与 versions.json。
 */
import { readFileSync, writeFileSync } from "node:fs";

const targetVersion = process.env.npm_package_version;

if (!targetVersion) {
  throw new Error("npm_package_version is not set; run via npm version");
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, "\t")}\n`);

const { minAppVersion } = manifest;
let versions = {};
try {
  versions = JSON.parse(readFileSync("versions.json", "utf8"));
} catch {
  // 空文件/首次发布：忽略，下面重建
}
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", `${JSON.stringify(versions, null, "\t")}\n`);
