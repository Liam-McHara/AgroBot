export function escapeHTML(str: string): string {
	return str.replace(/&/g, '&amp;')
						.replace(/</g, '&lt;')
						.replace(/>/g, '&gt;')
						.replace(/"/g, '&quot;')
						.replace(/'/g, '&#039;');
}

export function escapeMarkdownV2(str: string): string {
	return str.replace(/[_*\[\]()~`>#+-=|{}.!]/g, '\\$&');
}