const checkoutForm = document.querySelector('#checkout-form');
const orderStatus = document.querySelector('#order-status');
const discountButton = document.querySelector('.secondary-action');

discountButton?.addEventListener('click', () => {
  orderStatus.textContent = 'Discount applied';
});

checkoutForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  orderStatus.textContent = 'Order placed successfully';
});
