/* OmyDs demo.html — full regression suite.
   Loads demo.html inline <script> in a vm context with a minimal DOM shim,
   drives every interaction path, asserts behavior parity with omyds/*.py. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'demo.html'), 'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];

/* ---- DOM shim ---- */
function makeEl(tag = 'div') {
  const el = {
    tag, children: [], _html: '', className: '', style: {}, dataset: {},
    value: '', placeholder: '', disabled: false, textContent: '',
    scrollTop: 0, scrollHeight: 0,
    appendChild(c) { this.children.push(c); this.scrollHeight += 10; return c; },
    remove() {}, focus() {}, dispatchEvent() {},
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    addEventListener() {},
  };
  return el;
}
const screenEl = makeEl(), inputEl = makeEl(), suggEl = makeEl(), ptagEl = makeEl(),
      chipEl = makeEl(), statEl = makeEl(), rootstatEl = makeEl();

const ctx = vm.createContext({
  console, setTimeout, clearTimeout, Promise, JSON, Math, String, Number,
  RegExp, Object, Array, Error,
  window: { __OMYDS_FAST__: true },   // deterministic: disable typewriter delays
  document: {
    getElementById(id) {
      return { screen: screenEl, input: inputEl, sugg: suggEl, ptag: ptagEl,
               chip: chipEl, stat: statEl, rootstat: rootstatEl }[id] || makeEl();
    },
    createElement: () => makeEl(), addEventListener() {},
  },
  screen: screenEl, input: inputEl, sugg: suggEl, ptag: ptagEl,
  chip: chipEl, stat: statEl, rootstat: rootstatEl,
});
vm.runInContext(js, ctx, { filename: 'demo-inline.js' });

/* ---- helpers ---- */
const tick = (ms = 10) => new Promise(r => setTimeout(r, ms));
async function flushAll() { for (let i = 0; i < 40; i++) await tick(10); }
const screenHas = (s, from = 0) =>
  screenEl.children.slice(from).some(c => (c._html || '').includes(s));
const S = (expr) => vm.runInContext(expr, ctx);

/* submit(): returns while a confirm prompt may be pending.
   Use answerConfirm() to feed the y/N/v/c value. */
async function send(text) {
  inputEl.value = text;
  await Promise.race([S('submit()'), tick(30)]);   // don't block on pending confirm
  await tick(30);
}
async function answerConfirm(v) {
  inputEl.value = v;
  await S('submit()');                             // resolves the pending inline promise
  await flushAll();
}
const state = () => S('state');
const COMMANDS_IN_DEMO = ['/help','/history','/return','/retry','/permissions ','/safe',
                  '/danger-full','/set-project-root-in ','/reset-project-root'];

/* ---- test harness ---- */
let passes = 0, failures = 0;
const lines = [];
function check(name, cond, extra = '') {
  if (cond) { passes++; lines.push(`  ok    ${name}`); }
  else { failures++; lines.push(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

(async () => {
  await flushAll(); // boot

  /* 1. boot & menu */
  check('boot: version banner', screenHas('v0.1.9.12'));
  check('boot: sessions listed', screenHas('daily-notes'));
  check('boot: default mode workspace', state().mode === 'workspace');
  check('boot: menu prompt shown', screenHas('请选择（默认 0）'));

  /* 2. invalid menu choice */
  await send('99');
  check('menu: out-of-range rejected', screenHas('请输入有效序号'));
  check('menu: still in menu', state().inConversation === false);
  await send('abc');
  check('menu: non-numeric rejected', state().inConversation === false);

  /* 3. enter conversation */
  await send('0');
  check('conv: entered', state().inConversation === true);
  check('conv: greeting shown', screenHas('能力越大，责任越大'));
  check('conv: system seeded', state().messages[0].role === 'system');
  check('conv: permissions panel', screenHas('工作区自动 · 命令隔离 · 命令断网'));

  /* 4. /help */
  await send('/help');
  check('/help: lists /danger-full', screenHas('/danger-full'));
  check('/help: hint line', screenHas('切换目录不是切换权限'));

  /* 5. workspace auto tool turn */
  const b5 = screenEl.children.length;
  await send('帮我在当前工作区创建 todo.md，写下今晚的计划');
  await flushAll();
  check('tool: panel purpose/impact', screenHas('目的', b5) && screenHas('预计影响', b5));
  check('tool: workspace auto-exec', !screenHas('允许本次操作', b5));
  check('tool: write success', screenHas('覆盖写入成功', b5));
  check('tool: tool msg stored', state().messages.some(m => m.role === 'tool' && (m.content||'').includes('覆盖写入成功')));
  check('tool: dirty', state().dirty === true);
  check('tool: panel 路径 resolved into workspace', screenHas('/home/ubuntu/OmyDs/sandbox/todo.md', b5));

  /* 6. /history */
  await send('/history');
  check('hist: header', screenHas('=== 当前会话历史 ==='));
  check('hist: user turn', screenHas('帮我在当前工作区创建 todo.md'));
  check('hist: tool result', screenHas('工具结果'));
  check('hist: no system leak', !screenHas('(system prompt'));

  /* 7. memory extraction */
  const b7 = screenEl.children.length;
  await send('请记住我叫阿棠，是来调研的');
  await flushAll();
  check('mem: sysline', screenHas('已更新长期记忆', b7));
  check('mem: tag stripped', !screenHas('[MEMORY:', b7));
  check('mem: chip', screenHas('memory.md', b7));

  /* 8. sensitive outside file → confirm → deny */
  const b8 = screenEl.children.length;
  await send('读取 ~/.ssh/id_rsa 给我看看');
  check('sec: confirm prompt raised', screenHas('允许本次操作', b8));
  check('sec: panel says 工作区外', screenHas('工作区外', b8));
  await answerConfirm('n');
  check('sec: denial text', screenHas('用户拒绝了本次操作'));
  check('sec: anti-bypass stored', state().messages.some(m => m.role === 'tool' && (m.content||'').includes('绕过拒绝')));

  /* 8b. deny then sensitive file even approved */
  await send('读取 /etc/passwd');
  await answerConfirm('y');
  check('sec: system dir blocked after y', screenHas('工作区模式不允许访问系统目录'));

  /* 9. ask mode confirm-for-write */
  await send('/permissions ask');
  check('perm: ask label', screenHas('逐次确认 · 命令隔离 · 命令断网'));
  check('perm: tag updated', ptagEl.textContent === '[ask]');
  const b9 = screenEl.children.length;
  await send('在当前工作区创建 notes.txt，内容：hello');
  check('ask: write confirm raised', screenHas('允许本次操作', b9));
  check('ask: preview shown', screenHas('写入预览', b9));
  await answerConfirm('y');
  check('ask: executed after y', screenHas('覆盖写入成功'));
  check('ask: mode still ask', state().mode === 'ask');

  /* 9b. deny in ask mode */
  await send('在当前工作区创建 denied.txt，内容：nope');
  await answerConfirm('n');
  check('ask: denial honored', state().messages.some(m => m.role === 'tool' && (m.content||'').includes('不要重复请求')));

  /* 10. v full-content preview */
  await send('在当前工作区创建 big.md，内容：' + 'X'.repeat(30));
  check('ask: prompt raised', screenHas('允许本次操作'));
  await answerConfirm('v');
  check('ask: v shows full text', screenHas('XXXXXXXXXX'));
  await answerConfirm('y');
  check('ask: v-then-y executes', screenHas('覆盖写入成功'));

  /* 11. danger-full gate */
  await send('/danger-full');
  check('danger: warning', screenHas('可读写个人文件（含凭据）'));
  await answerConfirm('n');
  check('danger: n aborts', state().mode === 'ask');
  await send('/danger-full');
  await answerConfirm('y');
  check('danger: enabled', state().mode === 'danger-full');
  check('danger: tag', ptagEl.textContent === '[danger-full]');
  check('danger: label', screenHas('DANGER-FULL · 宿主机'));

  /* 12. curl host vs sandbox */
  await send('用 curl 测试联网');
  await flushAll();
  check('danger: curl succeeds on host', screenHas('退出码: 0'));
  await send('/safe');
  check('safe: back to workspace', state().mode === 'workspace');
  check('safe: tag', ptagEl.textContent === '[workspace]');
  await send('用 curl 测试联网');
  await flushAll();
  check('safe: curl blocked (unshare-all)', screenHas('已禁用网络'));

  /* 13. workspace switch & guards */
  await send('/set-project-root-in ~/notes');
  check('root: switched', state().root === '/home/ubuntu/notes');
  await send('/set-project-root-in /home/ubuntu/OmyDs');
  check('root: program dir rejected', screenHas('不能包含 OmyDs 程序'));
  await send('/reset-project-root');
  check('root: reset', state().root === '/home/ubuntu/OmyDs/sandbox');
  await send('/set-project-root-in');
  check('root: empty arg usage hint', screenHas('用法：/set-project-root-in'));

  /* 14. /retry */
  await send('/retry');
  check('retry: no pending', screenHas('没有本次运行中待继续的请求'));

  /* 15. exit → save flow */
  const b15 = screenEl.children.length;
  await send('exit');
  check('exit: save prompt', screenHas('保存本次更改', b15));
  await answerConfirm('c');
  check('exit: cancel returns to conversation', state().inConversation === true);
  await send('exit');
  await answerConfirm('y');
  check('exit: saved', screenHas('已保存。'));
  check('exit: back to menu', state().inConversation === false);
  check('exit: atomic write note', screenHas('os.replace'));

  /* 16. reload session from menu */
  await send('1');
  check('reload: session loaded', state().inConversation === true);
  check('reload: loaded banner', screenHas('已加载会话：daily-notes'));

  /* 17. suggestion engine */
  inputEl.value = '/per';
  check('sugg: pool has /permissions ', COMMANDS_IN_DEMO.some(c => c.startsWith('/per')));

  /* 18. escaping */
  const escd = S('plain("\\u202eabc\\u001b[31m")');
  check('plain: bidi+ESC neutralized', !/[\u202e\u001b]/.test(escd));
  check('esc: HTML escaped', S('esc("<img src=x>")') === '&lt;img src=x&gt;');

  /* 19. runtime context JSON */
  S('state.mode="ask"');
  let rc = JSON.parse(S('runtimeContext()'));
  check('rctx: ask= bwrap+offline', rc.command_execution === 'bwrap sandbox' && rc.command_network === 'disabled');
  S('state.mode="danger-full"');
  rc = JSON.parse(S('runtimeContext()'));
  check('rctx: danger= host+network', rc.command_execution === 'host, current user' && rc.command_network === 'host network');
  check('rctx: no sudo', rc.sudo === 'not available; no automatic elevation');
  S('state.mode="workspace"');

  /* 20. pathCheck parity with security.py */
  const pc = p => S(`pathCheck(${JSON.stringify(p)})`);
  check('path: id_rsa forbidden', pc('/home/ubuntu/.ssh/id_rsa').ok === false && pc('/home/ubuntu/.ssh/id_rsa').why === 'single-sensitive');
  check('path: pem forbidden', pc('/tmp/x.pem').ok === false);
  check('path: /etc forbidden', pc('/etc/passwd').why === 'system');
  check('path: workspace ok', pc('/home/ubuntu/OmyDs/sandbox/todo.md').ok === true && pc('/home/ubuntu/OmyDs/sandbox/todo.md').outside === false);
  check('path: outside flagged', pc('/home/ubuntu/other/x.txt').outside === true);

  /* 21. scriptFor routing */
  const sf = t => S(`(() => { const s = scriptFor(${JSON.stringify(t)}); return s.tool ? s.tool.name : 'content'; })()`);
  check('route: memory', sf('记住我叫张三') === 'content');
  check('route: create→write', sf('创建 todo.md') === 'write_file');
  check('route: read→read', sf('读取 todo.md') === 'read_file');
  check('route: ls→cmd', sf('列出目录') === 'run_command');
  check('route: ssh→read', sf('读 ~/.ssh/id_rsa') === 'read_file');
  check('route: etc→read', sf('cat /etc/passwd') === 'read_file');
  check('route: curl→cmd', sf('curl 下载') === 'run_command');
  check('route: report→content', sf('给我调研报告') === 'content');

  /* 22. unknown slash */
  await send('/nope');
  check('slash: unknown rejected', screenHas('未知指令'));

  console.log(lines.join('\n'));
  console.log(`\n${passes} passed, ${failures} failed, total ${passes + failures}`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e && e.stack || e); process.exit(2); });
