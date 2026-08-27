import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { Play, RotateCcw, Terminal, AlertTriangle, Save, FolderOpen, Trash2, X, Square } from 'lucide-react';
import { storageService } from '../services/storageService';
import { SavedSnippet } from '../types';
import {
  SANDBOX_MAX_LOGS,
  SANDBOX_TIMEOUT_MS,
  buildSandboxDocument,
  createRunId,
  parseSandboxMessage,
  toUserLineNumber,
} from '../utils/sandboxRuntime';

interface CodePlaygroundProps {
  initialCode: string;
}

interface LogEntry {
  type: 'log' | 'error' | 'warn';
  message: string;
}

interface RuntimeError {
  message: string;
  /** Already mapped back to the learner's own line numbering. */
  line?: number;
  col?: number;
  stack?: string;
}

/** Maps a sandbox console message type onto the log entry style. */
const LOG_TYPE_BY_MESSAGE: Record<string, LogEntry['type']> = {
  'console-log': 'log',
  'console-error': 'error',
  'console-warn': 'warn',
};

/** Reads the current app theme off the root element. */
const readIsDark = (): boolean => document.documentElement.classList.contains('dark');

export const CodePlayground: React.FC<CodePlaygroundProps> = ({ initialCode }) => {
  const [code, setCode] = useState(initialCode);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<RuntimeError | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [srcDoc, setSrcDoc] = useState('');
  const [isDark, setIsDark] = useState(readIsDark);

  const [savedSnippets, setSavedSnippets] = useState<SavedSnippet[]>([]);
  const [showSnippetsPanel, setShowSnippetsPanel] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [snippetNameDraft, setSnippetNameDraft] = useState('');

  useEffect(() => {
    setSavedSnippets(storageService.getSavedSnippets());
  }, []);

  const handleSaveSnippet = () => {
    const name = snippetNameDraft.trim();
    if (!name) return;
    storageService.saveSnippet(name, 'javascript', code);
    setSavedSnippets(storageService.getSavedSnippets());
    setSnippetNameDraft('');
    setShowSaveDialog(false);
  };

  const handleLoadSnippet = (snippet: SavedSnippet) => {
    setCode(snippet.code);
    setShowSnippetsPanel(false);
  };

  const handleDeleteSnippet = (id: string) => {
    setSavedSnippets(storageService.deleteSnippet(id));
  };

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Identifies the run currently being listened for. Messages carrying any
  // other id belong to a run the learner has already replaced, and are
  // dropped rather than appended to what is on screen.
  const runIdRef = useRef<string | null>(null);

  // Follow the app theme so the editor is not left on the previous colour
  // scheme after a light/dark switch. The theme is applied by Layout as a
  // class on <html>, so that is what we observe.
  useEffect(() => {
    const sync = () => setIsDark(readIsDark());
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const clearRunTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  /**
   * Ends the current run: stops listening for its messages, drops the
   * timeout, and tears down the iframe so a program still looping inside it
   * cannot keep burning CPU after the learner has moved on.
   */
  const stopRun = useCallback(() => {
    runIdRef.current = null;
    clearRunTimeout();
    setIsExecuting(false);
    setSrcDoc('');
  }, [clearRunTimeout]);

  /**
   * The other half of the sandbox contract.
   *
   * `event.source` is compared against this playground's own iframe because a
   * lesson page can mount several playgrounds at once (CourseView renders one
   * per code block), and every one of them has a listener attached to the
   * same window. `parseSandboxMessage` then rejects anything that is not a
   * well-formed message for the run we are actually waiting on.
   */
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const runId = runIdRef.current;
      if (!runId) return;
      if (event.source !== iframeRef.current?.contentWindow) return;

      const message = parseSandboxMessage(event.data, runId);
      if (!message) return;

      if (message.type === 'execution-success') {
        // The program reached the end of its synchronous body. Anything it
        // scheduled with setTimeout is deliberately not waited for - the
        // playground reports the run, not the event loop.
        stopRun();
        return;
      }

      if (message.type === 'runtime-error') {
        setError({
          message: message.message || 'Unknown error',
          line: toUserLineNumber(message.line),
          col: message.col,
          stack: message.stack,
        });
        stopRun();
        return;
      }

      const logType = LOG_TYPE_BY_MESSAGE[message.type];
      if (!logType) return;

      setLogs(prev => {
        const next = [...prev, { type: logType, message: message.message ?? '' }];
        // Keep the tail: the end of a runaway loop is what explains it.
        return next.length > SANDBOX_MAX_LOGS ? next.slice(-SANDBOX_MAX_LOGS) : next;
      });
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [stopRun]);

  // Never leave a timer or a running iframe behind on unmount - CourseView
  // mounts and unmounts these as the learner moves between lessons.
  useEffect(() => clearRunTimeout, [clearRunTimeout]);

  // Scroll to bottom of terminal inside container only without moving page viewport
  useEffect(() => {
    if (terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [logs, error]);

  const handleExecute = () => {
    // Replace any run still in flight so its messages cannot interleave with
    // the new one's output.
    clearRunTimeout();

    const runId = createRunId();
    runIdRef.current = runId;

    setLogs([]);
    setError(null);
    setIsExecuting(true);

    // Remounting the iframe on every run - rather than reusing one document -
    // is what guarantees a clean global scope, so a `const` declared last time
    // does not make this run fail with "already been declared".
    setSrcDoc('');
    const doc = buildSandboxDocument(code, runId);
    // Defer by a frame so React tears the old iframe down before the new
    // srcDoc is applied; setting both in one commit reuses the same element.
    requestAnimationFrame(() => {
      if (runIdRef.current !== runId) return;
      setSrcDoc(doc);
    });

    // Infinite-loop guard. A sandbox that never reaches its completion signal
    // is either looping forever or blocked, and either way the learner needs
    // the editor back.
    timeoutRef.current = setTimeout(() => {
      if (runIdRef.current !== runId) return;
      setLogs(prev => [
        ...prev,
        { type: 'error', message: 'Execution timed out after 4s (possible infinite loop).' },
      ]);
      stopRun();
    }, SANDBOX_TIMEOUT_MS);
  };

  const handleStop = () => {
    if (!isExecuting) return;
    setLogs(prev => [...prev, { type: 'warn', message: 'Execution stopped.' }]);
    stopRun();
  };

  const handleReset = () => {
    stopRun();
    setCode(initialCode);
    setLogs([]);
    setError(null);
  };

  return (
    <div className="bg-glass border border-black/25 dark:border-white/10 rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 w-full">
      {/* Editor Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 mr-2">
            <div className="w-3 h-3 rounded-full bg-[#ef4444] opacity-80" />
            <div className="w-3 h-3 rounded-full bg-[#eab308] opacity-80" />
            <div className="w-3 h-3 rounded-full bg-[#22c55e] opacity-80" />
          </div>
          <span className="text-xs font-mono text-textMuted font-semibold tracking-wide select-none">sandbox.js</span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowSnippetsPanel(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-textMuted hover:text-textMain hover:bg-black/5 dark:hover:bg-white/5 rounded-lg border border-black/10 dark:border-white/5 font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primaryLight"
            title="View saved snippets"
            aria-label="View saved snippets"
          >
            <FolderOpen size={12} />
            My Snippets{savedSnippets.length > 0 ? ` (${savedSnippets.length})` : ''}
          </button>

          <button
            type="button"
            onClick={() => { setSnippetNameDraft(''); setShowSaveDialog(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-textMuted hover:text-textMain hover:bg-black/5 dark:hover:bg-white/5 rounded-lg border border-black/10 dark:border-white/5 font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primaryLight"
            title="Save current code as a snippet"
            aria-label="Save current code as a snippet"
          >
            <Save size={12} />
            Save
          </button>

          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-textMuted hover:text-textMain hover:bg-black/5 dark:hover:bg-white/5 rounded-lg border border-black/10 dark:border-white/5 font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primaryLight"
            title="Reset to original code"
          >
            <RotateCcw size={12} />
            Reset
          </button>

          {isExecuting && (
            <button
              type="button"
              onClick={handleStop}
              title="Stop the running program"
              aria-label="Stop the running program"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-textMuted hover:text-textMain hover:bg-black/5 dark:hover:bg-white/5 rounded-lg border border-black/10 dark:border-white/5 font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primaryLight"
            >
              <Square size={12} fill="currentColor" />
              Stop
            </button>
          )}

          <button
            type="button"
            onClick={handleExecute}
            disabled={isExecuting}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-gradient-main hover:shadow-lg hover:shadow-primary/25 disabled:opacity-50 text-white font-bold rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-primaryLight"
          >
            {isExecuting ? (
              <>
                <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play size={12} fill="currentColor" />
                Run Code
              </>
            )}
          </button>
        </div>
      </div>

      {/* Monaco Editor Component */}
      <div className="relative border-b border-black/10 dark:border-white/5 bg-[#1e1e1e]">
        <Editor
          height="250px"
          defaultLanguage="javascript"
          language="javascript"
          value={code}
          onChange={(val) => setCode(val || '')}
          theme={isDark ? 'vs-dark' : 'light'}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: 'on',
            roundedSelection: true,
            scrollBeyondLastLine: false,
            readOnly: false,
            automaticLayout: true,
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
            padding: { top: 12, bottom: 12 }
          }}
        />
      </div>

      {/* Sandbox iframe. `allow-scripts` without `allow-same-origin` puts the
          document in an opaque origin, so learner code cannot touch this page,
          its storage, or its cookies - postMessage is the only way out. */}
      {srcDoc && (
        <iframe
          ref={iframeRef}
          style={{ display: 'none' }}
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          title="Sandbox Execution Environment"
        />
      )}

      {/* Output Terminal */}
      <div className="bg-[#050911] p-5 font-mono text-xs text-[#a9b2c3] border-t border-black/25 dark:border-white/5 shadow-inner">
        {/* Terminal Header */}
        <div className="flex items-center gap-2 mb-3 text-textMuted select-none border-b border-white/5 pb-2">
          <Terminal size={14} className="text-primaryLight" />
          <span className="font-bold uppercase tracking-wider text-[10px]">Console Output</span>
          {logs.length > 0 && (
            <span className="ml-auto text-[10px] font-mono opacity-60">
              {logs.length}
              {logs.length >= SANDBOX_MAX_LOGS ? `+ (showing last ${SANDBOX_MAX_LOGS})` : ''}
            </span>
          )}
        </div>

        {/* Terminal logs list with ref */}
        <div ref={terminalContainerRef} className="space-y-2 max-h-[160px] overflow-y-auto pr-2 custom-scrollbar">
          {logs.length === 0 && !error && (
            <div className="text-textMuted/60 italic select-none">Click "Run Code" to view execution results.</div>
          )}
          {logs.map((log, i) => (
            <div key={i} className={`flex items-start gap-2 ${log.type === 'error' ? 'text-red-400' : log.type === 'warn' ? 'text-yellow-400' : 'text-emerald-400'}`}>
              <span className="opacity-40 select-none">&gt;</span>
              <span className="whitespace-pre-wrap leading-relaxed">{log.message}</span>
            </div>
          ))}

          {error && (
            <div className="text-red-400 bg-red-950/25 p-3 rounded-xl border border-red-500/20 flex gap-2.5 mt-2 animate-fade-in">
              <AlertTriangle size={16} className="shrink-0 mt-0.5 text-red-400" />
              <div className="space-y-1">
                <div className="font-bold text-sm">Runtime Error: {error.message}</div>
                {error.line !== undefined && (
                  <div className="text-[11px] opacity-75 font-semibold">
                    at line {error.line}
                    {error.col !== undefined ? `, column ${error.col}` : ''}
                  </div>
                )}
                {error.stack && (
                  <pre className="text-[10px] opacity-60 overflow-x-auto whitespace-pre-wrap max-w-full font-mono mt-1 pt-1 border-t border-red-500/10">
                    {error.stack.split('\n').slice(0, 3).join('\n')}
                  </pre>
                )}
              </div>
            </div>
          )}
          <div ref={terminalEndRef} />
        </div>
      </div>

      {/* Save Snippet Dialog */}
      {showSaveDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowSaveDialog(false)}
        >
          <div
            className="bg-glass border border-black/20 dark:border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-textMain">Save Snippet</h3>
              <button
                type="button"
                onClick={() => setShowSaveDialog(false)}
                aria-label="Close save dialog"
                className="text-textMuted hover:text-textMain"
              >
                <X size={16} />
              </button>
            </div>
            <input
              type="text"
              autoFocus
              value={snippetNameDraft}
              onChange={(e) => setSnippetNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveSnippet(); }}
              placeholder="Snippet name (e.g. Two Sum solution)"
              className="w-full rounded-xl border border-black/20 dark:border-white/10 bg-white/50 dark:bg-white/5 p-2.5 text-sm text-textMain placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primaryLight"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setShowSaveDialog(false)}
                className="px-3 py-1.5 text-xs font-medium text-textMuted hover:text-textMain rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSnippet}
                disabled={!snippetNameDraft.trim()}
                className="px-4 py-1.5 text-xs bg-gradient-main text-white font-bold rounded-lg disabled:opacity-40 transition-all"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Saved Snippets Panel */}
      {showSnippetsPanel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowSnippetsPanel(false)}
        >
          <div
            className="bg-glass border border-black/20 dark:border-white/10 rounded-2xl p-6 w-full max-w-md max-h-[70vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h3 className="text-sm font-bold text-textMain">My Saved Snippets</h3>
              <button
                type="button"
                onClick={() => setShowSnippetsPanel(false)}
                aria-label="Close saved snippets panel"
                className="text-textMuted hover:text-textMain"
              >
                <X size={16} />
              </button>
            </div>

            {savedSnippets.length === 0 ? (
              <p className="text-sm text-textMuted italic">
                No saved snippets yet. Write some code and hit "Save" to keep it here.
              </p>
            ) : (
              <div className="space-y-2 overflow-y-auto custom-scrollbar pr-1">
                {savedSnippets.map((snippet) => (
                  <div
                    key={snippet.id}
                    className="flex items-center justify-between gap-3 bg-white/50 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-3"
                  >
                    <button
                      type="button"
                      onClick={() => handleLoadSnippet(snippet)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="text-sm font-semibold text-textMain truncate">{snippet.name}</div>
                      <div className="text-[11px] text-textMuted">
                        {snippet.language} &middot; {new Date(snippet.updatedAt).toLocaleDateString()}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSnippet(snippet.id)}
                      aria-label={`Delete snippet ${snippet.name}`}
                      className="p-1.5 rounded-lg text-textMuted hover:text-danger hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
