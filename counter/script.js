let count = 0;
const display = document.getElementById('count-display');

function render() {
  display.textContent = count;
}

document.getElementById('btn-increment').addEventListener('click', () => {
  count++;
  render();
});

document.getElementById('btn-decrement').addEventListener('click', () => {
  count--;
  render();
});

document.getElementById('btn-clear').addEventListener('click', () => {
  count = 0;
  render();
});
