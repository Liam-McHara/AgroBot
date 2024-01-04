export function parseOfferInput(input: string): { productName: string, amount: number } | null {
	const regex = /^\/\w+\s+([a-zA-Záéíóúàèòüñç·\s]+)\s+(\d+)$/;
	const match = input.match(regex);

	if (match && match.length === 3) {
		const amount = parseInt(match[2], 10);
		if (amount < 0)
			return null;
		return {
			productName: match[1].trim(),
			amount: amount
		};
	}

	return null;
}