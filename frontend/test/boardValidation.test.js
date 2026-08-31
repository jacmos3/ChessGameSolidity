import test from 'node:test';
import assert from 'node:assert/strict';
import {
	findInvalidChessPieces,
	isSupportedChessPiece,
	isValidChessBoardShape
} from '../src/lib/utils/boardValidation.js';

const emptyBoard = () => Array.from({ length: 8 }, () => Array(8).fill(0));

test('board validation accepts only empty and canonical signed chess pieces', () => {
	for (let piece = -128; piece <= 127; piece += 1) {
		assert.equal(isSupportedChessPiece(piece), piece >= -6 && piece <= 6, `piece ${piece}`);
	}
	assert.equal(isSupportedChessPiece(1.5), false);
	assert.equal(isSupportedChessPiece('6'), false);
});

test('board validation reports corrupted squares instead of hiding them', () => {
	const board = emptyBoard();
	board[2][3] = 7;
	board[5][6] = -128;

	assert.equal(isValidChessBoardShape(board), true);
	assert.deepEqual(findInvalidChessPieces(board), [
		{ row: 2, col: 3, value: 7 },
		{ row: 5, col: 6, value: -128 }
	]);
	assert.equal(isValidChessBoardShape(board.slice(0, 7)), false);
});
