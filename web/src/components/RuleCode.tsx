// "Show the code": the lines that enforce a rule, opened in place under it. The code comes from source.json, cut
// straight from the program (and, for no vamps, the worker) by scripts/source-snippets.mjs, so it's the source that is
// built and deployed, with its real line numbers.
import { useId, useState, type ReactNode } from 'react';
import source from '../lib/source.json';
import { useConfig } from '../lib/data';
import { I } from './ui';

export type CodeKey = keyof typeof source;
export type Block = { file: string; start: number; code: string };

const RS_KW = /^(fn|let|mut|if|else|return|pub|for|in|match|while|loop|as|use|const|struct|impl|self|crate|true|false)$/;
const JS_KW = /^(function|const|let|var|if|else|return|export|async|await|for|of|in|new|throw|true|false|null|import|from|this)$/;
const RS_TY = /^(u8|u16|u32|u64|u128|i64|usize|bool|str|Self|Ok|Err|Some|None|[A-Z][A-Za-z0-9_]*)$/;
const JS_TY = /^([A-Z][A-Za-z0-9_]*)$/;

/**
 * One line as coloured tokens: keywords, types, E::Errors, function calls, strings, numbers, the ? operator, and
 * comments (a whole comment line, or one at the end of a line).
 */
export function tokens(line: string, js: boolean): ReactNode[] {
  const t = line.trimStart();
  if (/^(\/\/|\/\*\*?|\*)/.test(t)) return [<span key="c" className="t-cm">{line}</span>];
  const KW = js ? JS_KW : RS_KW, TY = js ? JS_TY : RS_TY;
  const re = /(\/\/.*$)|(E::[A-Za-z]+)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)(?=\s*\(|!\()|([A-Za-z_][A-Za-z0-9_]*)|(\?)|(\s+|[^\sA-Za-z0-9_'"`?]+)/g;
  const out: ReactNode[] = [];
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(line)) !== null) {
    const key = k++;
    if (m[1]) out.push(<span key={key} className="t-cm">{m[1]}</span>);
    else if (m[2]) out.push(<span key={key} className="t-err">{m[2]}</span>);
    else if (m[3]) out.push(<span key={key} className="t-str">{m[3]}</span>);
    else if (m[4]) out.push(<span key={key} className="t-num">{m[4]}</span>);
    else if (m[5]) out.push(<span key={key} className={KW.test(m[5]) ? 't-kw' : TY.test(m[5]) ? 't-ty' : 't-fn'}>{m[5]}</span>);
    else if (m[6]) out.push(KW.test(m[6]) ? <span key={key} className="t-kw">{m[6]}</span> : TY.test(m[6]) ? <span key={key} className="t-ty">{m[6]}</span> : m[6]);
    else if (m[7]) out.push(<span key={key} className="t-op">?</span>);
    else out.push(/^\s+$/.test(m[8]) ? m[8] : <span key={key} className="t-p">{m[8]}</span>);
  }
  return out;
}

/**
 * A numbered line that wraps instead of running off the edge: its indentation becomes padding, and a wrapped line
 * carries on two characters further in, so the code's shape stays readable at any width.
 */
export function CodeLine({ n, line, js, className }: { n: number | string; line: string; js: boolean; className?: string }) {
  const lead = line.match(/^\s*/)![0].length;
  return (
    <span className={`cl${className ? ` ${className}` : ''}`}>
      <i aria-hidden>{n}</i>
      <span className="cl-t" style={{ paddingLeft: `${lead + 2}ch`, textIndent: '-2ch' }}>{tokens(line.slice(lead), js)}{'\n'}</span>
    </span>
  );
}

export function CodeBlock({ block, sourceUrl }: { block: Block; sourceUrl?: string | null }) {
  const [copied, setCopied] = useState(false);
  const lines = block.code.split('\n');
  const end = block.start + lines.length - 1;
  const js = block.file.endsWith('.js');
  const href = sourceUrl ? `${sourceUrl.replace(/\/$/, '')}/blob/main/${block.file}#L${block.start}-L${end}` : null;
  const name = block.file.split('/').pop();
  const copy = async () => { try { await navigator.clipboard.writeText(block.code); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* no clipboard */ } };
  return (
    <figure className="codeblock">
      <figcaption>
        <span className="cb-file"><i className={js ? 'js' : 'rs'} /><b>{name}</b><span className="cb-path">{block.file.slice(0, -(name?.length || 0))}</span><span className="cb-lines">L{block.start}{end > block.start ? `–${end}` : ''}</span></span>
        <span className="cb-tools">
          <span className={`cb-lang ${js ? 'js' : 'rs'}`}>{js ? 'JavaScript' : 'Rust'}</span>
          <button type="button" className="cb-copy" onClick={copy} aria-label="Copy the code">{copied ? <><I.check size={12} />Copied</> : <><I.copy size={12} />Copy</>}</button>
          {href && <a href={href} target="_blank" rel="noreferrer">GitHub <I.ext size={11} /></a>}
        </span>
      </figcaption>
      <pre><code>{lines.map((l, i) => <CodeLine key={i} n={block.start + i} line={l} js={js} />)}</code></pre>
    </figure>
  );
}

/** the toggle and, once opened, every block behind the rule */
export function RuleCode({ rule, label = 'Show the code', open: startOpen = false, note }: { rule: CodeKey; label?: string; open?: boolean; note?: ReactNode }) {
  const [open, setOpen] = useState(startOpen);
  const { data: cfg } = useConfig();
  const id = useId();
  const blocks = source[rule] as Block[];
  return (
    <div className={`rulecode${open ? ' open' : ''}`}>
      <button type="button" className="rc-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <I.code size={15} />{open ? 'Hide the code' : label}<span className="rc-chev"><I.chev size={14} /></span>
      </button>
      {open && (
        <div className="rc-body" id={id}>
          {note && <p className="rc-note">{note}</p>}
          {blocks.map((b, i) => <CodeBlock key={i} block={b} sourceUrl={cfg?.sourceUrl} />)}
        </div>
      )}
    </div>
  );
}
