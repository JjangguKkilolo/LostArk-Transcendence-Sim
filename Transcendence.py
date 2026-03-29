board = [
    [1, 1, 1, 1, 1],
    [1, 2, 2, 2, 1],
    [1, 2, 2, 2, 1],
    [1, 2, 2, 2, 1],
    [1, 1, 1, 1, 1]
]


def hit_tile(board, x, y):
    if 0 <= x < len(board) and 0 <= y < len(board[0]):
        if board[x][y] > 0:
            board[x][y] -= 1
            return True
    return False

def cross_attack(board, x, y):
    targets = [(x,y),(x-1,y),(x+1, y), (x, y-1), (x, y+1)]
    for tx, ty in targets:
        hit_tile(board, tx, ty)

cross_attack(board, 2, 3)

print(board)
