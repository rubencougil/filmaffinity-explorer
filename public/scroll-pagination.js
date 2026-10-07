(function () {
  window.createScrollPagination = function ({ sentinel, pageSize, renderBatch, updateMeta }) {
    let items = [];
    let shown = 0;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && shown < items.length) {
        appendBatch();
      }
    }, { rootMargin: '0px 0px 300px 0px' });

    function appendBatch() {
      observer.disconnect();
      const start = shown;
      shown = Math.min(shown + pageSize, items.length);
      renderBatch(items.slice(start, shown), start + 1, start > 0);
      updateMeta(shown, items.length);
      sentinel.hidden = items.length <= pageSize;
      sentinel.textContent = shown < items.length
        ? 'Desplázate para ver más resultados.'
        : 'Todos los resultados están cargados.';
      if (shown < items.length) {
        observer.observe(sentinel);
      }
    }

    return {
      reset(records) {
        items = records;
        shown = 0;
        appendBatch();
      },
      pause() {
        observer.disconnect();
        items = [];
        shown = 0;
        sentinel.hidden = true;
      }
    };
  };
}());
