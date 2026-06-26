document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const errorMessage = document.getElementById('errorMessage');
  const loginSpinner = document.getElementById('loginSpinner');
  const submitButtonText = loginForm.querySelector('.btn-primary span');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      showError('Please enter both username and password.');
      return;
    }

    // Show loading state
    loginSpinner.classList.remove('hidden');
    submitButtonText.classList.add('hidden');
    errorMessage.classList.add('hidden');

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Redirect to chat
        window.location.href = '/chat.html';
      } else {
        showError(data.error || 'Login failed. Please try again.');
      }
    } catch (err) {
      showError('Network error. Is the server running?');
      console.error(err);
    } finally {
      loginSpinner.classList.add('hidden');
      submitButtonText.classList.remove('hidden');
    }
  });

  function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.classList.remove('hidden');
  }
});
