document.addEventListener('DOMContentLoaded', function () {
    // Card click enhancement (navigate on click)
    document.querySelectorAll('.boss-card').forEach(c => {
        c.addEventListener('click', function (e) {
            const link = c.querySelector('.boss-link');
            if (link) window.location.href = link.getAttribute('href');
        });
    });

    // Boss page: checkbox state persistence (no dropdown)
    document.querySelectorAll('.plan-table input.player-check').forEach(chk => {
        chk.addEventListener('change', function () {
            const key = `check_${location.pathname}_${chk.dataset.playerIndex}_${chk.dataset.turnIndex}`;
            try { sessionStorage.setItem(key, chk.checked ? '1' : '0') } catch (e) { }
        });
        // restore
        const key = `check_${location.pathname}_${chk.dataset.playerIndex}_${chk.dataset.turnIndex}`;
        const val = sessionStorage.getItem(key);
        if (val === '1') chk.checked = true;
    });
});
