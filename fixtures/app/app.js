const checkoutForm = document.querySelector('#checkout-form');
const orderStatus = document.querySelector('#order-status');
const discountButton = document.querySelector('.secondary-action');
const placeOrderButton = document.querySelector('[data-target="place-order"]');
const termsCheckbox = document.querySelector('[data-testid="checkout-terms"]');
const termsRow = document.querySelector('.checkbox-row');
const cardholderLabel = document.querySelector('label[for="cardholder-name"]');
const shippingCountry = document.querySelector('#shipping-country');
const shippingCountryLabel = document.querySelector('label[for="shipping-country"]');
const mutation = new URLSearchParams(window.location.search).get('mutation');

const applies = (name) => mutation === name || mutation === 'drifted-all';

if (applies('drifted-cardholder')) {
  if (cardholderLabel !== null) {
    cardholderLabel.textContent = 'Cardholder Name';
  }
}

if (applies('drifted-country')) {
  shippingCountry?.setAttribute('id', 'delivery-country');
  shippingCountryLabel?.setAttribute('for', 'delivery-country');
}

if (
  applies('drifted-terms') ||
  mutation === 'ambiguous-drifted-terms' ||
  mutation === 'drifted-disabled-terms'
) {
  termsCheckbox?.setAttribute('data-testid', 'accept-terms');
}

if (mutation === 'ambiguous-drifted-terms') {
  termsRow?.after(termsRow.cloneNode(true));
}

if (mutation === 'drifted-disabled-terms') {
  termsCheckbox?.setAttribute('disabled', '');
}

if (applies('drifted-place-order')) {
  if (placeOrderButton !== null) {
    placeOrderButton.textContent = 'Place Order';
  }
}

if (applies('drifted-discount')) {
  if (discountButton !== null) {
    discountButton.textContent = 'Apply Discount';
  }
}

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
