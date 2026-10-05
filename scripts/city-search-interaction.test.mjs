import assert from 'node:assert/strict';
import test from 'node:test';
import { attachCitySearchDismissal, preserveSearchFocus } from '../src/lib/city-search-interaction.mjs';

function fixture() {
  const listeners = new Map();
  const input = {};
  const option = {};
  const optionLabel = {};
  const outside = {};
  let open = true;
  const target = scope => ({
    addEventListener(type, handler, capture = false) { listeners.set(`${scope}:${type}`, { handler, capture }); },
    removeEventListener(type, handler, capture = false) {
      const registered = listeners.get(`${scope}:${type}`);
      assert.equal(registered?.handler, handler);
      assert.equal(registered?.capture, capture);
      listeners.delete(`${scope}:${type}`);
    },
  });
  const root = { ...target('root'), ownerDocument: target('document'),
    contains: node => [input, option, optionLabel, root].includes(node) };
  const dispose = attachCitySearchDismissal(root, () => { open = false; });
  return { input, option, optionLabel, outside, listeners, dispose, isOpen: () => open,
    dispatch: (scope, type, event) => listeners.get(`${scope}:${type}`)?.handler(event) };
}

test('touch and pen presses are not cancelled, so native taps and scrolling remain available', () => {
  for (const pointerType of ['touch', 'pen']) {
    preserveSearchFocus({ pointerType, button: 0, preventDefault: () => assert.fail('Touch/pen was cancelled') });
  }
});

test('only primary mouse presses prevent input focus loss', () => {
  let prevented = 0;
  preserveSearchFocus({ pointerType: 'mouse', button: 0, preventDefault: () => { prevented++; } });
  assert.equal(prevented, 1);
  for (const button of [1, 2]) preserveSearchFocus({ pointerType: 'mouse', button,
    preventDefault: () => assert.fail('Non-primary button was cancelled') });
});

test('a mobile option tap survives input blur until its click can select the city', () => {
  const panel = fixture();
  panel.dispatch('document', 'pointerdown', { target: panel.optionLabel });
  panel.dispatch('root', 'focusout', { target: panel.input, relatedTarget: null });
  assert.equal(panel.isOpen(), true, 'A transient blur must not unmount the option.');
  panel.dispatch('document', 'click', { target: panel.optionLabel });
  assert.equal(panel.isOpen(), true, 'Selection is left to the option click handler.');
});

test('scrolling within suggestions keeps the dropdown open without forcing selection', () => {
  const panel = fixture();
  panel.dispatch('document', 'pointerdown', { target: panel.option });
  panel.dispatch('root', 'focusout', { target: panel.input, relatedTarget: null });
  // Native scrolling cancels the pointer gesture and does not generate an option click.
  assert.equal(panel.isOpen(), true);
});

test('outside taps, disabled controls and keyboard-generated clicks dismiss the dropdown', () => {
  for (const type of ['pointerdown', 'click']) {
    const panel = fixture();
    assert.equal(panel.listeners.get(`document:${type}`).capture, true);
    panel.dispatch('document', type, { target: panel.outside });
    assert.equal(panel.isOpen(), false);
  }
});

test('Tab to another control dismisses, while moving focus within the search does not', () => {
  const panel = fixture();
  panel.dispatch('root', 'focusout', { relatedTarget: panel.option });
  assert.equal(panel.isOpen(), true);
  panel.dispatch('root', 'focusout', { relatedTarget: panel.outside });
  assert.equal(panel.isOpen(), false);
});

test('cleanup removes listeners and safely handles an unavailable root', () => {
  const panel = fixture();
  panel.dispose();
  assert.equal(panel.listeners.size, 0);
  assert.doesNotThrow(() => attachCitySearchDismissal(null, () => {})());
});
