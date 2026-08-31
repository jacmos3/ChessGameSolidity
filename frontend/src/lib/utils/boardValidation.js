export function isSupportedChessPiece(value) {
	return Number.isInteger(value) && value >= -6 && value <= 6;
}

export function isValidChessBoardShape(board) {
	return Array.isArray(board) && board.length === 8 &&
		board.every((row) => Array.isArray(row) && row.length === 8);
}

export function findInvalidChessPieces(board) {
	if (!isValidChessBoardShape(board)) return [];

	const invalid = [];
	for (let row = 0; row < 8; row += 1) {
		for (let col = 0; col < 8; col += 1) {
			if (!isSupportedChessPiece(board[row][col])) {
				invalid.push({ row, col, value: board[row][col] });
			}
		}
	}
	return invalid;
}
