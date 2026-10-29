(function () {
  'use strict';
  // Stakeholder surveys list and Send page: confirm before sending, closing, removing or deleting.
  document.querySelectorAll('form[data-confirm]').forEach(f => f.addEventListener('submit', e => { if (!confirm(f.dataset.confirm)) e.preventDefault(); }));
})();
