import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.js';
import { getCart, addItemToCart, removeItemFromCart , updateItemQty } from '../controller/cart.controller.js';

const cartRouter = Router();

cartRouter.use(authMiddleware);

cartRouter.get('/', getCart);
cartRouter.post('/items', addItemToCart);
cartRouter.delete('/items/:itemId', removeItemFromCart);
cartRouter.patch('/items/:itemId', updateItemQty);

export default cartRouter;