import assert from "node:assert/strict";
import { test } from "node:test";
import { protectText, restoreText } from "../shared/protected-text";

test("round-trips fenced code, inline code, URLs and paths without translating their bytes", () => {
  const source = '解释 **结果**：`a+b`、``a`b`` [链接](https://example.test/a?q=$x) 和 src/main.ts、/tmp/a.json、C:\\Users\\user\\a.ts\n~~~ts\nconst fence = "```";\n~~~\n完成';
  const protectedText = protectText(source);
  assert.ok(protectedText.values.length >= 7);
  assert.ok(!protectedText.text.includes("const fence"));
  assert.ok(!protectedText.text.includes("example.test"));
  assert.equal(restoreText(protectedText.text.replace("解释", "Explain"), protectedText), source.replace("解释", "Explain"));
});

test("protects unclosed fences and permits longer closing fences only on their own line", () => {
  for (const source of ['正文\n```js\nconst x = "```";\n尾部', '正文\n```js\nconst x = 1;\n````\n结尾']) {
    const protectedText = protectText(source);
    assert.equal(restoreText(protectedText.text, protectedText), source);
    assert.ok(protectedText.values.some((value) => value.startsWith("```js")));
  }
});

test("uses a collision-free prefix and restores replacement metacharacters literally", () => {
  const source = '__PASEO_KEEP_0__ 说明 `$& $1 $$`';
  const protectedText = protectText(source);
  assert.notEqual(protectedText.prefix, "__PASEO_KEEP_");
  assert.equal(restoreText(protectedText.text, protectedText), source);
});

test("rejects missing, repeated and invented protected placeholders", () => {
  const protectedText = protectText("说明 `code` 和 https://example.test/path");
  const marker = `${protectedText.prefix}0__`;
  assert.equal(restoreText(protectedText.text.replace(marker, ""), protectedText), undefined);
  assert.equal(restoreText(protectedText.text + marker, protectedText), undefined);
  assert.equal(restoreText(protectedText.text + `${protectedText.prefix}99__`, protectedText), undefined);
});


test("handles long ordinary tokens and backtick runs within bounded time", { timeout: 1500 }, () => {
  for (const source of ["a".repeat(64000), "`".repeat(64000), "a " + "`".repeat(63998)]) {
    const startedAt = Date.now();
    const protectedText = protectText(source);
    assert.equal(restoreText(protectedText.text, protectedText), source);
    assert.ok(Date.now() - startedAt < 1000);
  }
});

test("chooses collision-free placeholders even for an adversarial long prefix", { timeout: 1500 }, () => {
  const source = "_".repeat(63980) + "PASEO_KEEP_ `x`";
  const startedAt = Date.now();
  const protectedText = protectText(source);
  assert.equal(restoreText(protectedText.text, protectedText), source);
  assert.ok(Date.now() - startedAt < 500);
});

test("protects Unicode and quoted space-containing macOS and Windows paths whole", () => {
  const paths = [
    "/Users/张三/项目/main.ts", "C:\\Users\\张三\\项目\\main.ts", "项目/模块/main.ts",
    '"/Users/张三/我的 项目/main.ts"', "'C:\\Users\\张三\\My Project\\main.ts'",
    "\\\\server\\共享目录\\文件.ts",
  ];
  const source = `解释 ${paths.join(" 和 ")} 然后继续`;
  const protectedText = protectText(source);
  for (const path of paths) assert.ok(protectedText.values.includes(path), `unprotected path: ${path}`);
  assert.doesNotMatch(protectedText.text, /张三|项目|共享目录|My Project/);
  assert.equal(restoreText(protectedText.text, protectedText), source);
});

test("protects four-space and tab-indented Markdown code blocks with blank lines", () => {
  const source = '说明\n\n    const 用户 = "保持";\n    console.log(用户);\n\n    return 用户;\n\n后续说明\n\n\tprint("也要保持")\n';
  const protectedText = protectText(source);
  assert.doesNotMatch(protectedText.text, /console|return|print|用户|也要保持/);
  assert.match(protectedText.text, /说明/);
  assert.equal(restoreText(protectedText.text, protectedText), source);
});
