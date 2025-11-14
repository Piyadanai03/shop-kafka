import express from 'express';
import { registerUser } from '../controllers/register.controller.js';
import { loginUser } from '../controllers/login.controller.js';
import { getProfile, updateProfile } from '../controllers/profile.controller.js';

import {authMiddleware}  from '../middlewares/auth.js';

const routerUser = express.Router();

routerUser.post('/register', registerUser);
routerUser.post('/login', loginUser);
routerUser.get('/profile', authMiddleware, getProfile);
routerUser.put('/profile', authMiddleware, updateProfile);

export default routerUser;
