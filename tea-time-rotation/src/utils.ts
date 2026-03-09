export interface DrinkPrice {
  drink_type: string;
  sugar_level: string;
  price: number;
}

export function formatCost(amount: number): string {
  return amount.toLocaleString('en-IN') + '₹';
}

export function resolvePrice(drink: string, sugar: string, prices: DrinkPrice[]): number {
  const exact = prices.find(p => p.drink_type === drink && p.sugar_level === sugar);
  if (exact) return exact.price;
  const drinkWild = prices.find(p => p.drink_type === drink && p.sugar_level === '*');
  if (drinkWild) return drinkWild.price;
  const wildSugar = prices.find(p => p.drink_type === '*' && p.sugar_level === sugar);
  if (wildSugar) return wildSugar.price;
  const wildWild = prices.find(p => p.drink_type === '*' && p.sugar_level === '*');
  if (wildWild) return wildWild.price;
  return 20;
}
