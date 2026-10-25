// Exposes the official Netlify Identity SDK to the portal pages as window.FCVAuth.
import { login, logout, getUser, handleAuthCallback, acceptInvite, requestPasswordRecovery, updateUser, onAuthChange } from '@netlify/identity';
window.FCVAuth = { login, logout, getUser, handleAuthCallback, acceptInvite, requestPasswordRecovery, updateUser, onAuthChange };
