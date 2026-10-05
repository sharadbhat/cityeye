/** Light-dismiss a native details panel without intercepting clicks inside it. */
export function attachDetailsDismissal(details) {
  if (!details) return () => {};
  const document = details.ownerDocument;
  const dismissOutside = (event) => {
    if (details.open && !details.contains(event.target)) details.open = false;
  };
  const dismissEscape = (event) => {
    if (details.open && event.key === 'Escape') {
      details.open = false;
      event.preventDefault();
      details.querySelector('summary')?.focus();
    }
  };
  // Capture also catches outside clicks whose target stops propagation.
  // Pointerdown covers disabled controls; click covers keyboard activation.
  document.addEventListener('pointerdown', dismissOutside, true);
  document.addEventListener('click', dismissOutside, true);
  document.addEventListener('keydown', dismissEscape);
  return () => {
    document.removeEventListener('pointerdown', dismissOutside, true);
    document.removeEventListener('click', dismissOutside, true);
    document.removeEventListener('keydown', dismissEscape);
  };
}
