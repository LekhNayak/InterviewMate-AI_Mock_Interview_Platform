const express = require('express');
const userRouter = express.Router();
const {
    requestOtp, signup, login, profile, updateProfile, logout,
    changePassword, deleteUser, demoStatus, demoLogin, serviceToken,
} = require('../handlers/user.handler');
const { userAuth } = require('../middleware/auth.middleware');


userRouter.post('/signup/request-otp', requestOtp);
userRouter.post('/signup/complete', signup);
userRouter.post('/login', login);
userRouter.get('/demo', demoStatus);
userRouter.post('/demo-login', demoLogin);
userRouter.get('/profile', userAuth, profile);
userRouter.get('/service-token', userAuth, serviceToken);
userRouter.put('/update', userAuth, updateProfile);
// No userAuth: an expired session must still be able to clear its cookie.
userRouter.put('/logout', logout);
userRouter.patch('/change-password', userAuth, changePassword);
userRouter.delete('/delete', userAuth, deleteUser);

module.exports = userRouter;
