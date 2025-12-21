document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('users-app')) initUsers();
});

async function initUsers() {
    await loadUsers();
}

let users = [];
async function loadUsers() {
    const res = await fetch('/api/admin/users');
    if (!res.ok) return;
    users = await res.json();
    renderUsers();
}

function renderUsers() {
    const app = document.getElementById('users-app');
    app.innerHTML = '';
    const add = document.createElement('button'); add.textContent = 'Add User'; add.addEventListener('click', showAddUserForm);
    app.appendChild(add);
    const list = document.createElement('div');
    users.forEach(u => {
        const row = document.createElement('div'); row.className = 'user-row';
        row.innerHTML = `<strong>${u.username}</strong> <span class="role">${u.role}</span> <button class="edit">Edit</button> <button class="del">Delete</button>`;
        row.querySelector('.edit').addEventListener('click', () => showEditUser(u));
        row.querySelector('.del').addEventListener('click', async () => { if (confirm('Delete user?')) { await fetch('/api/admin/users?id=' + u.id, { method: 'DELETE' }); await loadUsers(); } });
        list.appendChild(row);
    });
    app.appendChild(list);
}

function showAddUserForm() {
    const app = document.getElementById('users-app');
    app.innerHTML = `
      <h2>Create User</h2>
      <form id="create-user">
        <label>Username</label><input name="username" />
        <label>Password</label><input name="password" type="password" />
        <label>Role</label>
        <select name="role"><option value="author">author</option><option value="mod">mod</option><option value="admin">admin</option></select>
        <button>Create</button>
        <button type="button" id="cancel">Cancel</button>
      </form>
    `;
    document.getElementById('cancel').addEventListener('click', loadUsers);
    document.getElementById('create-user').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target; const payload = { username: f.username.value, password: f.password.value, role: f.role.value };
        const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) await loadUsers(); else alert('Failed to create');
    });
}

function showEditUser(u) {
    const app = document.getElementById('users-app');
    app.innerHTML = `
      <h2>Edit User: ${u.username}</h2>
      <form id="edit-user">
        <input type="hidden" name="id" value="${u.id}" />
        <label>Role</label>
        <select name="role"><option value="author" ${u.role === 'author' ? 'selected' : ''}>author</option><option value="mod" ${u.role === 'mod' ? 'selected' : ''}>mod</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option></select>
        <label>New Password (leave blank to keep)</label>
        <input name="password" type="password" />
        <button>Save</button>
        <button type="button" id="cancel">Cancel</button>
      </form>
    `;
    document.getElementById('cancel').addEventListener('click', loadUsers);
    document.getElementById('edit-user').addEventListener('submit', async (e) => {
        e.preventDefault(); const f = e.target; const payload = { id: parseInt(f.id.value), role: f.role.value }; if (f.password.value) payload.password = f.password.value;
        const res = await fetch('/api/admin/users', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) await loadUsers(); else alert('Failed to save');
    });
}
