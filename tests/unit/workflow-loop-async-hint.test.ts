import {
  findLoopBodyDeferringNodes as findCoreLoopBodyDeferring,
} from '../../packages/core/src/workflow/graph-validate';
import {
  findLoopBodyDeferringNodes as findSharedLoopBodyDeferring,
} from '../../shared/email-workflow-graph-validate';

type Node = { id: string; type: string; data: Record<string, unknown> };
type Edge = { id: string; source: string; target: string; label?: string };

function graph(nodes: Node[], edges: Edge[]) {
  return { version: 1 as const, nodes, edges } as never;
}

function registry(id: string, nodeType: string, config: Record<string, unknown> = {}): Node {
  return { id, type: 'registry', data: { nodeType, config } };
}

const trigger: Node = { id: 't', type: 'trigger', data: { kind: 'manual' } };
const loop = registry('loop', 'logic.loop', { items: 'a,b' });

// F-A9-04: Ein asynchroner Knoten im Je-Eintrag-Zweig einer Schleife lässt die
// Schleife nach dem ersten Eintrag abbrechen; der Editor muss das beim Speichern
// sagen. Beide Kopien (core für Server/Desktop-Runtime, shared für den Renderer)
// müssen übereinstimmen.
describe.each([
  ['core', findCoreLoopBodyDeferring],
  ['shared', findSharedLoopBodyDeferring],
] as const)('loop body deferring nodes (%s)', (_name, findLoopBodyDeferring) => {
  test('flags an HTTP request with a follow-up in the each branch (server)', () => {
    const doc = graph(
      [trigger, loop, registry('http', 'http.request', { url: 'https://x.test' }), registry('tag', 'email.tag')],
      [
        { id: 'e1', source: 't', target: 'loop' },
        { id: 'e2', source: 'loop', target: 'http', label: 'each' },
        { id: 'e3', source: 'http', target: 'tag' },
      ],
    );
    expect(findLoopBodyDeferring(doc, { edition: 'server' })).toEqual(['http']);
    // Auf dem Desktop läuft HTTP synchron.
    expect(findLoopBodyDeferring(doc, { edition: 'desktop' })).toEqual([]);
  });

  test('flags ai.decide in the each branch on the server (always a background job)', () => {
    const doc = graph(
      [trigger, loop, registry('dec', 'ai.decide', { question: 'Spam?' })],
      [
        { id: 'e1', source: 't', target: 'loop' },
        { id: 'e2', source: 'loop', target: 'dec', label: 'each' },
      ],
    );
    expect(findLoopBodyDeferring(doc, { edition: 'server' })).toEqual(['dec']);
    // Auf dem Desktop läuft die KI-Entscheidung synchron.
    expect(findLoopBodyDeferring(doc, { edition: 'desktop' })).toEqual([]);
  });

  test('accepts an HTTP request without a follow-up and nodes behind the done edge', () => {
    const doc = graph(
      [
        trigger,
        loop,
        registry('http', 'http.request', { url: 'https://x.test' }),
        registry('ai', 'ai.classify', { labels: 'x' }),
        registry('tag', 'email.tag'),
      ],
      [
        { id: 'e1', source: 't', target: 'loop' },
        { id: 'e2', source: 'loop', target: 'http', label: 'each' },
        { id: 'e3', source: 'loop', target: 'ai', label: 'done' },
        { id: 'e4', source: 'ai', target: 'tag' },
      ],
    );
    expect(findLoopBodyDeferring(doc, { edition: 'server' })).toEqual([]);
  });

  test('flags a delay in the each branch in both editions, also behind other nodes', () => {
    const doc = graph(
      [trigger, loop, registry('tag', 'email.tag'), registry('wait', 'logic.delay', { delaySeconds: 60 })],
      [
        { id: 'e1', source: 't', target: 'loop' },
        { id: 'e2', source: 'loop', target: 'tag', label: 'each' },
        { id: 'e3', source: 'tag', target: 'wait' },
        { id: 'e4', source: 'wait', target: 'loop' },
      ],
    );
    expect(findLoopBodyDeferring(doc, { edition: 'server' })).toEqual(['wait']);
    expect(findLoopBodyDeferring(doc, { edition: 'desktop' })).toEqual(['wait']);
  });

  test('ignores an AI review whose only edge is the block port (no continuation)', () => {
    const doc = graph(
      [trigger, loop, registry('review', 'ai.review', { blockKeyword: 'BLOCK' }), registry('tag', 'email.tag')],
      [
        { id: 'e1', source: 't', target: 'loop' },
        { id: 'e2', source: 'loop', target: 'review', label: 'each' },
        { id: 'e3', source: 'review', target: 'tag', label: 'block' },
      ],
    );
    expect(findLoopBodyDeferring(doc, { edition: 'server' })).toEqual([]);
  });

  test('flags server AI nodes that always continue asynchronously', () => {
    const doc = graph(
      [trigger, loop, registry('draft', 'ai.draft_reply')],
      [
        { id: 'e1', source: 't', target: 'loop' },
        { id: 'e2', source: 'loop', target: 'draft', label: 'each' },
      ],
    );
    expect(findLoopBodyDeferring(doc, { edition: 'server' })).toEqual(['draft']);
  });
});
