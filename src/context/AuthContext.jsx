import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, login as firebaseLogin, logout as firebaseLogout, onAuthStateChange } from '../firebase';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChange((user) => {
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const login = async (email, password) => {
    try {
      await firebaseLogin(email, password);
    } catch (error) {
      console.error("Error en login:", error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await firebaseLogout();
    } catch (error) {
      console.error("Error en logout:", error);
    }
  };

  const value = { user, loading, login, logout };
  return <AuthContext.Provider value={value}>{!loading && children}</AuthContext.Provider>;
};
