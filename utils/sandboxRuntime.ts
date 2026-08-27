/**
 * The document that runs a learner's code inside the playground iframe, and
 * the contract for talking to it.
 *
 * The iframe is created with `sandbox="allow-scripts"` and no
 * `allow-same-origin`, so it lands in an opaque origin: the parent cannot
 * reach into it and it cannot reach back out except through `postMessage`.
 * That is the whole channel, which makes the message shapes below the actual
 * API between the two sides — worth keeping in one file rather than inline in
 * a template literal.
 *
 * Two details that used to be easy to get wrong are handled here:
 *
 *  - **Line numbers.** The learner's code is spliced into a wrapper, so an
 *    error the browser reports on line 42 is not line 42 of what they typed.
 *    `SANDBOX_PREAMBLE_LINE_COUNT` is derived from the template itself, so
 *    editing the wrapper can no longer silently desynchronise the number.
 *  - **Run identity.** Every document is stamped with a run id that it echoes
 *    back on every message. A slow message from a previous run therefore can
 *    not append output to the run the learner is currently watching.
 */

/** How long to wait for a run to signal completion before assuming it hung. */
export const SANDBOX_TIMEOUT_MS = 4000;

/**
 * Upper bound on retained console lines. A runaway `for (;;) console.log(i)`
 * can emit tens of thousands of messages before the timeout fires; keeping
 * them all would freeze the tab that is trying to report the problem.
 */
export const SANDBOX_MAX_LOGS = 500;

export type SandboxMessageType =
    | 'console-log'
    | 'console-error'
    | 'console-warn'
    | 'runtime-error'
    | 'execution-success';

export interface SandboxMessage {
    type: SandboxMessageType;
    /** Echo of the run id the document was stamped with. */
    runId: string;
    message?: string;
    line?: number;
    col?: number;
    stack?: string;
}

/** Marker property so a message from this runtime is recognisable at a glance. */
const SANDBOX_CHANNEL = 'skillverse-playground';

/**
 * Everything that precedes the learner's code in the generated document.
 *
 * `runId` is interpolated as a JSON string literal so it cannot break out of
 * the script, and the whole preamble is kept free of template placeholders
 * other than that one, so its line count is stable per run.
 */
const buildPreamble = (runId: string): string => `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <script>
      (function () {
        var RUN_ID = ${JSON.stringify(runId)};
        var CHANNEL = ${JSON.stringify(SANDBOX_CHANNEL)};

        // Also parked on window so the epilogue's catch block - which lives in
        // a separate <script> and therefore outside this closure - can stamp
        // the same id on the failure it reports.
        window.__skillverseRunId = RUN_ID;

        function send(payload) {
          payload.channel = CHANNEL;
          payload.runId = RUN_ID;
          try {
            window.parent.postMessage(payload, '*');
          } catch (e) {
            /* The parent may already be gone if the learner navigated away. */
          }
        }

        function format(value) {
          if (value === null) return 'null';
          if (value === undefined) return 'undefined';
          if (typeof value === 'string') return value;
          if (typeof value === 'function') return value.toString();
          if (value instanceof Error) return value.name + ': ' + value.message;
          if (typeof value === 'object') {
            try {
              return JSON.stringify(value, null, 2);
            } catch (e) {
              /* Circular structures and BigInt both throw here. */
              return String(value);
            }
          }
          return String(value);
        }

        function forward(type) {
          return function () {
            var parts = [];
            for (var i = 0; i < arguments.length; i++) parts.push(format(arguments[i]));
            send({ type: type, message: parts.join(' ') });
          };
        }

        var log = forward('console-log');
        window.console = {
          log: log,
          info: log,
          debug: log,
          error: forward('console-error'),
          warn: forward('console-warn'),
          trace: log,
          table: log,
          dir: log,
          group: log,
          groupEnd: function () {},
          time: function () {},
          timeEnd: function () {},
          assert: function () {}
        };

        window.onerror = function (message, source, lineno, colno, errorObj) {
          send({
            type: 'runtime-error',
            message: errorObj ? errorObj.message : String(message),
            line: lineno,
            col: colno,
            stack: errorObj && errorObj.stack ? errorObj.stack : ''
          });
          return true;
        };

        window.onunhandledrejection = function (event) {
          var reason = event && event.reason;
          send({
            type: 'runtime-error',
            message: reason && reason.message ? reason.message : 'Unhandled promise rejection: ' + format(reason),
            stack: reason && reason.stack ? reason.stack : ''
          });
        };

        window.__skillverseDone = function () {
          send({ type: 'execution-success' });
        };
      })();
    </script>
  </head>
  <body>
    <script>
      try {
`;

/** Everything that follows the learner's code. */
const EPILOGUE = `
        window.__skillverseDone();
      } catch (err) {
        window.parent.postMessage({
          channel: ${JSON.stringify(SANDBOX_CHANNEL)},
          runId: window.__skillverseRunId,
          type: 'runtime-error',
          message: err && err.message ? err.message : String(err),
          stack: err && err.stack ? err.stack : ''
        }, '*');
      }
    </script>
  </body>
</html>`;

/**
 * Number of lines the wrapper adds above the learner's first line.
 *
 * Derived from the template rather than hardcoded: the preamble is built once
 * with a placeholder run id (its length does not affect the line count, since
 * it is interpolated inside a single line) and its newlines are counted.
 */
export const SANDBOX_PREAMBLE_LINE_COUNT = buildPreamble('probe').split('\n').length - 1;

/**
 * Maps a line number reported by the browser back to the line the learner
 * actually typed. Returns `undefined` when the mapping would land outside the
 * user's code, which is what happens for errors thrown from inside the
 * wrapper itself — better to show no line than a misleading one.
 */
export const toUserLineNumber = (reportedLine: number | undefined): number | undefined => {
    if (typeof reportedLine !== 'number' || Number.isNaN(reportedLine)) return undefined;
    const mapped = reportedLine - SANDBOX_PREAMBLE_LINE_COUNT;
    return mapped > 0 ? mapped : undefined;
};

/** Builds the full document for one run of `code`. */
export const buildSandboxDocument = (code: string, runId: string): string =>
    `${buildPreamble(runId)}${code}${EPILOGUE}`;

const MESSAGE_TYPES: SandboxMessageType[] = [
    'console-log',
    'console-error',
    'console-warn',
    'runtime-error',
    'execution-success',
];

/**
 * Validates an incoming `MessageEvent` payload.
 *
 * The parent window receives messages from anything on the page — other
 * playgrounds mounted into the same lesson, embedded widgets, extensions — so
 * the payload is only accepted when it carries this runtime's channel marker,
 * a known type, and the run id the caller is currently waiting on. The caller
 * separately checks `event.source`; this is the second half of that check.
 */
export const parseSandboxMessage = (data: unknown, expectedRunId: string): SandboxMessage | null => {
    if (typeof data !== 'object' || data === null) return null;

    const payload = data as Record<string, unknown>;
    if (payload.channel !== SANDBOX_CHANNEL) return null;
    if (payload.runId !== expectedRunId) return null;
    if (typeof payload.type !== 'string') return null;
    if (!MESSAGE_TYPES.includes(payload.type as SandboxMessageType)) return null;

    return {
        type: payload.type as SandboxMessageType,
        runId: expectedRunId,
        message: typeof payload.message === 'string' ? payload.message : undefined,
        line: typeof payload.line === 'number' ? payload.line : undefined,
        col: typeof payload.col === 'number' ? payload.col : undefined,
        stack: typeof payload.stack === 'string' ? payload.stack : undefined,
    };
};

/** Monotonic-ish id for a run. Uniqueness only has to hold within one tab. */
export const createRunId = (): string =>
    `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
