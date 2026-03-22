const express = require('express');
const router = express.Router();
const admin = require('../firebaseAdmin');

// GET /api/users/profile
router.get('/profile', async (req, res) => {
  try {
    const { uid } = req.user;
    
    const userRef = admin.firestore().collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    const userData = userDoc.data();
    res.json({
      success: true,
      user: userData
    });
    
  } catch (error) {
    console.error('Error getting user profile:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT /api/users/profile
router.put('/profile', async (req, res) => {
  try {
    const { uid } = req.user;
    const { 
      displayName, 
      username, 
      bio, 
      website, 
      location, 
      isPublic,
      customFields 
    } = req.body;
    
    // Validate username if provided
    if (username) {
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(username) || username.length < 3 || username.length > 30) {
        return res.status(400).json({ error: 'Username inválido' });
      }
      
      // Check if username is already taken
      const usersCol = admin.firestore().collection('users');
      const existingUser = await usersCol
        .where('username', '==', username)
        .where(admin.firestore.FieldPath.documentId(), '!=', uid)
        .limit(1)
        .get();
      
      if (!existingUser.empty) {
        return res.status(400).json({ error: 'Username ya está en uso' });
      }
    }
    
    const updateData = {
      updatedAt: new Date()
    };
    
    if (displayName !== undefined) updateData.displayName = displayName;
    if (username !== undefined) updateData.username = username;
    
    // Update metadata
    const currentUserRef = admin.firestore().collection('users').doc(uid);
    const currentUserDoc = await currentUserRef.get();
    const currentData = currentUserDoc.exists ? currentUserDoc.data() : {};
    const currentMetadata = currentData.metadata || {};
    
    updateData.metadata = {
      ...currentMetadata,
      bio: bio !== undefined ? bio : currentMetadata.bio,
      website: website !== undefined ? website : currentMetadata.website,
      location: location !== undefined ? location : currentMetadata.location,
      isPublic: isPublic !== undefined ? Boolean(isPublic) : currentMetadata.isPublic,
      customFields: customFields !== undefined ? customFields : currentMetadata.customFields
    };
    
    await currentUserRef.set(updateData, { merge: true });
    
    res.json({
      success: true,
      message: 'Perfil actualizado exitosamente'
    });
    
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/users/by-username/:username
router.get('/by-username/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { uid } = req.user;
    
    if (!username) {
      return res.status(400).json({ error: 'Username requerido' });
    }
    
    const usersCol = admin.firestore().collection('users');
    const userQuery = await usersCol
      .where('username', '==', username)
      .limit(1)
      .get();
    
    if (userQuery.empty) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();
    
    // Only return public data unless it's the user's own profile
    if (userDoc.id !== uid && !userData.metadata?.isPublic) {
      return res.status(403).json({ error: 'Perfil privado' });
    }
    
    // Filter sensitive data
    const publicData = {
      uid: userDoc.id,
      displayName: userData.displayName,
      username: userData.username,
      photoURL: userData.photoURL,
      createdAt: userData.createdAt,
      metadata: userData.metadata
    };
    
    res.json({
      success: true,
      user: publicData
    });
    
  } catch (error) {
    console.error('Error getting user by username:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/users/initialize
router.post('/initialize', async (req, res) => {
  try {
    const { uid, email, displayName, photoURL } = req.user;
    
    const userRef = admin.firestore().collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (userDoc.exists) {
      return res.json({
        success: true,
        message: 'Usuario ya existe',
        user: userDoc.data()
      });
    }
    
    // Generate username from email
    const baseUsername = email.split('@')[0].toLowerCase().replace(/[^\w]/g, '');
    let username = baseUsername;
    
    // Check for username uniqueness
    const usersCol = admin.firestore().collection('users');
    let counter = 1;
    while (true) {
      const existingUser = await usersCol
        .where('username', '==', username)
        .limit(1)
        .get();
      
      if (existingUser.empty) break;
      username = `${baseUsername}${counter}`;
      counter++;
    }
    
    const userData = {
      uid,
      email,
      displayName: displayName || '',
      photoURL: photoURL || '',
      username,
      planQuotaBytes: 1073741824, // 1GB default
      usedBytes: 0,
      pendingBytes: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        bio: '',
        website: '',
        location: '',
        isPublic: false,
        customFields: {}
      }
    };
    
    await userRef.set(userData);
    
    res.json({
      success: true,
      message: 'Usuario inicializado exitosamente',
      user: userData
    });
    
  } catch (error) {
    console.error('Error initializing user:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
