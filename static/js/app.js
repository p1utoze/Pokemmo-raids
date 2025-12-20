document.addEventListener('DOMContentLoaded', function () {
    // Card click enhancement (navigate on click)
    document.querySelectorAll('.boss-card').forEach(c => {
        c.addEventListener('click', function (e) {
            const link = c.querySelector('.boss-link');
            if (link) window.location.href = link.getAttribute('href');
        });
    });

    // Boss page: checkbox state persistence (no dropdown)
    const checkboxes = Array.from(document.querySelectorAll('.plan-table input.player-check'));
    checkboxes.forEach(chk => {
        const cell = chk.closest('.player-cell');
        chk.addEventListener('change', function () {
            const key = `check_${location.pathname}_${chk.dataset.playerIndex}_${chk.dataset.turnIndex}`;
            try { sessionStorage.setItem(key, chk.checked ? '1' : '0') } catch (e) { }
            if (cell) cell.classList.toggle('completed', chk.checked);
        });
        // restore
        const key = `check_${location.pathname}_${chk.dataset.playerIndex}_${chk.dataset.turnIndex}`;
        const val = sessionStorage.getItem(key);
        if (val === '1') {
            chk.checked = true;
            if (cell) cell.classList.add('completed');
        }
    });

    // View more / sidebar toggle
    const viewBtn = document.getElementById('viewMoreBtn');
    const sidebar = document.getElementById('rightSidebar');
    const closeBtn = document.getElementById('closeSidebar');
    if (viewBtn && sidebar) {
        viewBtn.addEventListener('click', function () { sidebar.classList.add('open'); sidebar.setAttribute('aria-hidden', 'false'); });
    }
    if (closeBtn && sidebar) {
        closeBtn.addEventListener('click', function () { sidebar.classList.remove('open'); sidebar.setAttribute('aria-hidden', 'true'); });
    }
});
