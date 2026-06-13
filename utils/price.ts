/** Parses a price string like "Rs. 500" into its numeric value (500). */
export function parsePrice(priceText: string): number {
  const value = parseInt(priceText.replace(/[^\d]/g, ''), 10);
  if (isNaN(value)) throw new Error(`Unexpected price format: "${priceText}"`);
  return value;
}

/** Formats a numeric amount back into the site's "Rs. <amount>" display format. */
export function formatPrice(amount: number): string {
  return `Rs. ${amount}`;
}
