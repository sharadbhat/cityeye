import test from 'node:test';
import assert from 'node:assert/strict';
import { attachDetailsDismissal } from '../src/lib/details-dismissal.mjs';

function fixture() {
  const listeners = new Map();
  const inside = { name: 'popover' };
  const summary = { name: 'summary', focus: () => { focused = true; } };
  let focused = false;
  const document = {
    addEventListener(type, handler, capture = false) { listeners.set(type, { handler, capture }); },
    removeEventListener(type, handler, capture = false) {
      assert.equal(listeners.get(type)?.handler, handler);
      assert.equal(listeners.get(type)?.capture, capture);
      listeners.delete(type);
    },
  };
  const details = { open: true, ownerDocument: document, contains: (target) => target === inside || target === summary, querySelector: () => summary };
  const dispose = attachDetailsDismissal(details);
  return { details, inside, summary, listeners, dispose, focused: () => focused,
    dispatch: (type, event) => listeners.get(type)?.handler(event) };
}

test('outside pointer and keyboard-generated clicks dismiss an open panel in capture phase', () => {
  for (const type of ['pointerdown', 'click']) {
    const panel = fixture();
    assert.equal(panel.listeners.get(type).capture, true);
    panel.dispatch(type, { target: { name: 'outside' } });
    assert.equal(panel.details.open, false);
    assert.equal(panel.focused(), false);
  }
});

test('clicking the instructions or summary preserves native details behavior', () => {
  const panel = fixture();
  for (const target of [panel.inside, panel.summary]) {
    for (const type of ['pointerdown', 'click']) panel.dispatch(type, { target });
    assert.equal(panel.details.open, true);
  }
  panel.details.open = false;
  panel.dispatch('click', { target: {} });
  assert.equal(panel.details.open, false);
});

test('Escape closes the panel and restores focus to its trigger', () => {
  const panel = fixture();
  let prevented = false;
  panel.dispatch('keydown', { key: 'Enter' });
  assert.equal(panel.details.open, true);
  panel.dispatch('keydown', { key: 'Escape', preventDefault: () => { prevented = true; } });
  assert.equal(panel.details.open, false);
  assert.equal(panel.focused(), true);
  assert.equal(prevented, true);
  // A closed panel must not swallow Escape used by another control.
  panel.dispatch('keydown', { key: 'Escape', preventDefault: () => assert.fail('Closed panel intercepted Escape') });
});

test('cleanup removes all document listeners and tolerates a missing ref', () => {
  const panel = fixture();
  panel.dispose();
  assert.equal(panel.listeners.size, 0);
  panel.dispatch('click', { target: {} });
  assert.equal(panel.details.open, true);
  assert.doesNotThrow(() => attachDetailsDismissal(null)());
});
