import { IUser } from "./models/User";

// Returns an array of all the users' names having something to offer
// excluding 'tgId'.
function getOtherProducers(tgId: number, users: IUser[]): string[] {
	console.log(`Getting other producers...`);
	let otherProducers: string[] = [];
	users.forEach(user => {
		if (user.tgId !== tgId && user.offers.length > 0) {
			otherProducers.push(user.name);
			console.log(`- ${user.name}`);
		}
	});
	return otherProducers;
}

// Returns an array of all the products' names of the 'producerName'
function getProducts(producerName: string, users: IUser[]): string[] {
	console.log(`Getting products...`);
	let products: string[] = [];
	const user = users.find((user) => user.name === producerName);
	console.log(`user: ${user.name} (${user.tgId})`);
	user.offers.forEach(product => {
		products.push(product.productName);
		console.log(`- ${product.productName}`);
	});
	return products;
}

export { getOtherProducers, getProducts };