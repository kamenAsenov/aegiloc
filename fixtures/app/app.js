const checkoutForm = document.querySelector('#checkout-form');
const orderStatus = document.querySelector('#order-status');
const discountButton = document.querySelector('.secondary-action');
const placeOrderButton = document.querySelector('[data-target="place-order"]');
const mutation = new URLSearchParams(window.location.search).get('mutation');

if (placeOrderButton instanceof HTMLButtonElement) {
  switch (mutation) {
    case 'missing-place-order':
      placeOrderButton.remove();
      break;
    case 'delayed-place-order': {
      const parent = placeOrderButton.parentElement;
      placeOrderButton.remove();
      setTimeout(() => parent?.append(placeOrderButton), 150);
      break;
    }
    case 'disabled-place-order':
      placeOrderButton.disabled = true;
      break;
    case 'duplicate-place-order':
      placeOrderButton.before(placeOrderButton.cloneNode(true));
      break;
    case 'detached-place-order':
      placeOrderButton.disabled = true;
      setTimeout(() => placeOrderButton.remove(), 100);
      break;
  }
}

discountButton?.addEventListener('click', () => {
  orderStatus.textContent = 'Discount applied';
});

checkoutForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  orderStatus.textContent = 'Order placed successfully';
});
