const checkoutForm = document.querySelector('#checkout-form');
const orderStatus = document.querySelector('#order-status');

checkoutForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  orderStatus.textContent = 'Order placed successfully';
});
