// Chiselchat is a simple, easily-extensible data layer for multi-user,
// multi-room chat, built entirely on [Firebase](https://firebase.com).
//
// The Chiselchat object is the primary conduit for all underlying data events.
// It exposes a number of methods for binding event listeners, creating,
// entering, or leaving chat rooms, initiating chats, sending messages,
// and moderator actions such as warning, kicking, or suspending users.
//
//     Chiselchat.js 0.1.0
//     https://firebase.com
//     (c) 2013 Firebase
//     License: MIT

// Setup
// --------------
(function(Firebase) {

  // Establish a reference to the `window` object, and save the previous value
  // of the `Chiselchat` variable.
  var root = this,
      previousChiselchat = root.Chiselchat;

  function Chiselchat(firebaseRef, options) {

    // Instantiate a new connection to Firebase.
    this._firebase = firebaseRef;

    // User-specific instance variables.
    this._user = null;
    this._userId = null;
    this._userName = null;
    this._avatarUri = '';
    this._profileUri = '';
    this._isModerator = false;
    this._isStaff = false;
    this._isGuest = false;

    // A unique id generated for each session.
    this._sessionId = null;

    // A mapping of event IDs to an array of callbacks.
    this._events = {};

    // A mapping of room IDs to a boolean indicating presence.
    this._rooms = {};

    // A mapping of operations to re-queue on disconnect.
    this._presenceBits = {};

    // Commonly-used Firebase references.
    this._userRef        = null;
    this._messageRef     = this._firebase.child('room-messages');
    this._roomRef        = this._firebase.child('room-metadata');
    this._privateRoomRef = this._firebase.child('room-private-metadata');
    this._moderatorsRef  = this._firebase.child('moderators');
    this._suspensionsRef = this._firebase.child('suspensions');
    this._usersOnlineRef = this._firebase.child('user-names-online');
    this._guestNameList = [ 'Arnold', 'Burton', 'Cal', 'Caroline', 'Peabody','Pubert', 'Gomez', 'Morticia', 'Wednesday', 'Uncle Fester', 'Pugsly',
    'Greggory', 'Greg', 'Bruce', 'Jean Claude', 'Herobrine', 'Cake', 'Lilith', 'Penelope', 'Rhiannon', 'Medusa', 'Sally', 'Barry', 'Elmer', 'Gretel',
    'Chris', 'David', 'Donald', 'Dude', 'Dudette', 'Ernest', 'Esther', 'Fern', 'Gertrude', 'Gus', 'Hazel', 'Isobel', 'Kevin', 'Malcolm', 'Neville', 'Oscar', 'Paul', 'Quentin', 'Rupert', 'Simon', 'Thom', 'Vern', 'Wally', 'Trudy', 'Bertha', 'Abernathy','Adolf','Attila','Kurt','Helen','Marv','Magda',
    'Hansel', 'Mort', 'Gunther', 'Dreshawn', 'Percy', 'Shaneekwa', 'Ronald', 'Tyquasia', 'Tallulah', 'Margot', 'Ennis', 'Roscoe', 'Heloise',
    'Eunice', 'Cecil', 'Bueford', 'Eustace', 'Baxter','Tiara','Garland','Judy', 'Cooter', 'Daisy', 'Cletus', 'Crystal', 'Martha', 'Jesse', 'Bo', 'Luke',
    'Martha', 'Jefferson', 'Martha','Albert', 'Beauregard', 'Al', 'Peggy', 'Bud', 'Kelly','Igor','Boris','Natasha','Moose','Squirrel','Fannie', 'Chuck',
    'Dennis','Hamish', 'Angus', 'Tate', 'Mildred', 'Waldo', 'Stewart', 'Horace', 'Jean Luc', 'William', 'Beverly', 'Data', 'Geordi', 'Worf', 'Deanna',
    'James', 'Spock', 'Leonard', 'Pavel', 'Hickaru','Nyota','Wesley','Laren','Miles','Keiko','Montgomery','Christine','Janice'];

    // Setup and establish default options.
    this._options = options || {};

    // cache of user data
    this._chatter_cache = {};

    // The number of historical messages to load per room.
    this._options.numMaxMessages = this._options.numMaxMessages || 50;
  }

  // Run Chiselchat in *noConflict* mode, returning the `Chiselchat` variable to
  // its previous owner, and returning a reference to the Chiselchat object.
  Chiselchat.noConflict = function noConflict() {
    root.Chiselchat = previousChiselchat;
    return Chiselchat;
  };

  // Export the Chiselchat object as a global.
  root.Chiselchat = Chiselchat;

  // Chiselchat Internal Methods
  // --------------
  Chiselchat.prototype = {

    // Load the initial metadata for the user's account and set initial state.
    _loadUserMetadata: function(onComplete) {
      var self = this;

      // Update the user record on every visit.
      this._userRef.transaction(function(current) {
          var account_data = {
            id: self._userId,
            name: self._userName,
            avatarUri: self._avatarUri,
            profileUri: self._profileUri,
            isModerator: self._isModerator,
            isStaff: self._isStaff,
            isGuest: self._isGuest
          };
          if (current) {
            if (current.rooms) {
               account_data.rooms = current.rooms;
            }
            if (current.sessions) {
                account_data.sessions = current.sessions;
            }
            if (current.muted) {
                account_data.muted = current.muted;
            }
          }
          if (account_data.isGuest) {
            if (!current || current.name === '' || typeof(current.name) === 'undefined') {
              account_data.name = 'Guest '+self._guestNameList[ Math.floor(Math.random() * self._guestNameList.length) ];
              self._userName = account_data.name;
              console.log("setting guest name to "+account_data.name);
            }
            else {
              self._userName = current.name;
              account_data.name = current.name;
              console.log("using existing guest name "+account_data.name);
            }
          }
          return account_data;
      }, function(error, committed, snapshot) {
        if (!error) {
            self._user = snapshot.val(); 
            //Preload the user cache to save a remote fetch.
            self._chatter_cache[self._user.id] = self._user;
            self._moderatorsRef.child(self._userId).once('value', function(snapshot) {
              self._isModerator = !!snapshot.val();
              root.setTimeout(onComplete, 0);
            });
        }
        else {
            console.warn(error);
        }
      }, false);
    },

    // Initialize Firebase listeners and callbacks for the supported bindings.
    _setupDataEvents: function() {
      // Monitor connection state so we can requeue disconnect operations if need be.
      this._firebase.root().child('.info/connected').on('value', function(snapshot) {
        if (snapshot.val() === true) {
          // We're connected (or reconnected)! Set up our presence state.
          for (var i = 0; i < this._presenceBits; i++) {
            var op = this._presenceBits[i],
                ref = this._firebase.root().child(op.ref);

            ref.onDisconnect().set(op.offlineValue);
            ref.set(op.onlineValue);
          }
        }
      }, this);

      // Generate a unique session id for the visit.
      var sessionRef = this._userRef.child('sessions').push();
      this._sessionId = sessionRef.name();
      this._queuePresenceOperation(sessionRef, true, null);

      // Register our username in the public user listing.
      var usernameRef = this._usersOnlineRef.child(this._userName.toLowerCase());
      var usernameSessionRef = usernameRef.child(this._sessionId);
      this._queuePresenceOperation(usernameSessionRef, {
        id: this._userId,
        name: this._userName
      }, null);

      // Listen for state changes for the given user.
      this._userRef.on('value', this._onUpdateUser, this);

      // Listen for chat invitations from other users.
      this._userRef.child('invites').on('child_added', this._onChiselchatInvite, this);

      // Listen for messages from moderators and adminstrators.
      this._userRef.child('notifications').on('child_added', this._onNotification, this);
        
      // make people leave room if a room is deleted
      var self = this;
      this._roomRef.on('child_removed', function(snapshot) {
          self.leaveRoom(snapshot.name());
      });              

      // Listen for new rooms being created
      this._roomRef.startAt(Date.now()).on('child_added', function(snapshot){
        this._onCreateRoom(snapshot);
      }, this);

      self._roomRef.on('child_changed',function(snapshot, prevChildName) {
          self._invokeEventCallbacks('room-changed', snapshot.val());
      });        
        
    },

    // Append the new callback to our list of event handlers.
    _addEventCallback: function(eventId, callback) {
      this._events[eventId] = this._events[eventId] || [];
      this._events[eventId].push(callback);
    },

    // Retrieve the list of event handlers for a given event id.
    _getEventCallbacks: function(eventId) {
      if (this._events.hasOwnProperty(eventId)) {
        return this._events[eventId];
      }
      return [];
    },

    // Invoke each of the event handlers for a given event id with specified data.
    _invokeEventCallbacks: function(eventId) {
      var args = [],
          callbacks = this._getEventCallbacks(eventId);

      Array.prototype.push.apply(args, arguments);
      args = args.slice(1);

      for (var i = 0; i < callbacks.length; i += 1) {
        callbacks[i].apply(null, args);
      }
    },

    // Keep track of on-disconnect events so they can be requeued if we disconnect the reconnect.
    _queuePresenceOperation: function(ref, onlineValue, offlineValue) {
      ref.onDisconnect().set(offlineValue);
      ref.set(onlineValue);
      this._presenceBits[ref.toString()] = {
        ref: ref,
        onlineValue: onlineValue,
        offlineValue: offlineValue
      };
    },

    // Remove an on-disconnect event from firing upon future disconnect and reconnect.
    _removePresenceOperation: function(path, value) {
      var ref = new Firebase(path);
      ref.onDisconnect().cancel();
      ref.set(value);
      delete this._presenceBits[path];
    },

    // Event to monitor current user state.
    _onUpdateUser: function(snapshot) {
      this._user = snapshot.val();
      this._invokeEventCallbacks('user-update', this._user);
    },

      
    // Event to monitor current user state.
    _onCreateRoom: function(snapshot) {
      var room = snapshot.val();
      this._invokeEventCallbacks('room-create', room);
    },   
      
    // Event to monitor current auth + user state.
    _onAuthRequired: function() {
      this._invokeEventCallbacks('auth-required');
    },

    // Events to monitor room entry / exit and messages additional / removal.
    _onEnterRoom: function(room) {
      this._invokeEventCallbacks('room-enter', room);
    },
    _onNewMessage: function(roomId, snapshot, prevChildKey) {
      var message = snapshot.val();
      message.id = snapshot.name();
      message.prevChildId = prevChildKey;
      this._invokeEventCallbacks('message-add', roomId, message);
    },
    _onRemoveMessage: function(roomId, snapshot) {
      var messageId = snapshot.name();
      this._invokeEventCallbacks('message-remove', roomId, messageId);
    },
    _onLeaveRoom: function(roomId) {
      this._invokeEventCallbacks('room-exit', roomId);
    },

    // Event to listen for notifications from administrators and moderators.
    _onNotification: function(snapshot) {
      var notification = snapshot.val();
      if (!notification.read) {
          snapshot.ref().child('read').set(true);
        this._invokeEventCallbacks('notification', notification);
      }
        else {
            snapshot.ref().remove();
        }
    },

    // Events to monitor chat invitations and invitation replies.
    _onChiselchatInvite: function(snapshot) {
      var self = this,
          invite = snapshot.val();

      // Skip invites we've already responded to.
      if (invite.status) {
        return;
      }

      invite.id = invite.id || snapshot.name();
      self.getRoom(invite.roomId, function(room) {
        invite.toRoomName = room.name;
        self._invokeEventCallbacks('room-invite', invite);
      });
    },
    _onChiselchatInviteResponse: function(snapshot) {
      var self = this,
          invite = snapshot.val();

      invite.id = invite.id || snapshot.name();
      this._invokeEventCallbacks('room-invite-response', invite);
    }
  };

  // Chiselchat External Methods
  // --------------

  // Initialize the library and setup data listeners.
  Chiselchat.prototype.setUser = function(userObj, callback) {
    var self = this;

    self._firebase.root().child('.info/authenticated').on('value', function(snapshot) {
      if (snapshot.val() === true) {
        self._firebase.root().child('.info/authenticated').off();

        self._userId      = userObj.userId;
        self._userName    = userObj.userName;
        self._isModerator = userObj.isModerator;
        self._avatarUri   = userObj.avatarUri;
        self._profileUri  = userObj.profileUri;
        self._isGuest     = userObj.isGuest;
        self._isStaff     = userObj.isStaff;
        if (self._isModerator === true) {
            self._moderatorsRef.child(self._userId).set(true);
            self._moderatorsRef.child(self._userId).onDisconnect().remove();
        }
        self._userRef = self._firebase.child('users').child(self._userId);
        self._loadUserMetadata(function() {
          root.setTimeout(function() {
            self._setupDataEvents();
            callback(self._user);
          }, 0);
        });
      }
    });
  };
    
    
 // Uninit everything if a user logs out in a SPWA
  Chiselchat.prototype.unsetUser = function() {
        var self = this;
        self._userRef.child('rooms').once('value', function(snapshot) {
            var rooms = snapshot.val();
            for (var roomId in rooms) {
                self.leaveRoom(rooms[roomId].id);
            }
            self._firebase.root().child('.info/connected').off();
            self._userRef.child('invites').off();
            self._userRef.child('notifications').off();
            self._userRef.off();
            self._firebase.root().child('.info/authenticated').off();
            self._user = null;
            self._userId = null;
            self._userName = null;
            self._isModerator = false;
            self._isGuest = true;
            self._avatarUri   = null;
            self._profileUri  = null;
            self._sessionId = null;
            self._userRef = null;
        });
  };
        
    // User-specific instance variables.

  //Load user data from firebase for display in messages and presence.
  //After the data is found
  Chiselchat.prototype.lookupUser = function(userId, callback) {
    var self = this;
    if (!( userId in self._chatter_cache)) {
      var userRef = self._firebase.child('users').child(userId).once('value', function (snap) {
        var user = snap.val();
        self._chatter_cache[userId] = user;
        callback(user);
      });
    }
    else {
        callback(this._chatter_cache[userId]);
    }
  };

  // Resumes the previous session by automatically entering rooms.
  Chiselchat.prototype.resumeSession = function() {
    this._userRef.child('rooms').once('value', function(snapshot) {
      var rooms = snapshot.val();
      for (var roomId in rooms) {
        this.enterRoom(rooms[roomId].id);
      }
    }, /* onError */ function(){}, /* context */ this);
    // join any official rooms
    this._roomRef.once('value', function(snapshot) {
      var rooms = snapshot.val();
      for (var roomId in rooms) {
        if (rooms[roomId].type != 'official') continue;
        this.enterRoom(roomId);
      }
    }, /* onError */ function(){}, /* context */ this);
  };

  // Callback registration. Supports each of the following events:
  Chiselchat.prototype.on = function(eventType, cb) {
    this._addEventCallback(eventType, cb);
  };

  // Create and automatically enter a new chat room.
  Chiselchat.prototype.createRoom = function(roomName, roomType, callback) {
    var self = this,
        newRoomRef = this._roomRef.push();

    var newRoom = {
      id: newRoomRef.name(),
      name: roomName,
      type: roomType || 'public',
      createdByUserId: this._userId,
      '.priority': Firebase.ServerValue.TIMESTAMP
    };

    if (roomType === 'private') {
      newRoom.authorizedUsers = {};
      newRoom.authorizedUsers[this._userId] = true;
    }

    newRoomRef.set(newRoom, function(error) {
      if (!error) {
        self.enterRoom(newRoomRef.name());
      }
      if (callback) {
        callback(newRoomRef.name());
      }
    });
  };

  // Enter a chat room.
  Chiselchat.prototype.enterRoom = function(roomId) {
    var self = this;
    self.getRoom(roomId, function(room) {
      var roomName = room.name;

      if (!roomId || !roomName) return;

      // Skip if we're already in this room.
      if (self._rooms[roomId]) {
        return;
      }

      self._rooms[roomId] = true;

      if (self._user) {
        // Save entering this room to resume the session again later.
        self._userRef.child('rooms').child(roomId).set({
          id: roomId,
          name: roomName,
          active: true
        });

        // Set presence bit for the room and queue it for removal on disconnect.
        var presenceRef = self._firebase.child('room-users').child(roomId).child(self._userId).child(self._sessionId);
        self._queuePresenceOperation(presenceRef, {
          id: self._userId,
          name: self._userName
        }, null);
      }

      // Invoke our callbacks before we start listening for new messages.
      self._onEnterRoom({ id: roomId, name: roomName });

      // Setup message listeners
      self._roomRef.child(roomId).once('value', function(snapshot) {
        self._messageRef.child(roomId).limit(self._options.numMaxMessages).on('child_added', function(snapshot, prevChildKey) {
          self._onNewMessage(roomId, snapshot, prevChildKey);
        }, /* onCancel */ function() {
          // Turns out we don't have permission to access these messages.
          self.leaveRoom(roomId);
        }, /* context */ self);

        self._messageRef.child(roomId).limit(self._options.numMaxMessages).on('child_removed', function(snapshot) {
          self._onRemoveMessage(roomId, snapshot);
        }, /* onCancel */ function(){}, /* context */ self);
      }, /* onFailure */ function(){}, self);
    });
  };

  // Leave a chat room.
  Chiselchat.prototype.leaveRoom = function(roomId) {
    var self = this,
        userRoomRef = self._firebase.child('room-users').child(roomId);

    // Remove listener for new messages to this room.
    self._messageRef.child(roomId).off();

    if (self._user) {
      var presenceRef = userRoomRef.child(self._userId).child(self._sessionId);

      // Remove presence bit for the room and cancel on-disconnect removal.
      self._removePresenceOperation(presenceRef.toString(), null);

      // Remove session bit for the room.
      self._userRef.child('rooms').child(roomId).remove();
    }

    delete self._rooms[roomId];

    // Invoke event callbacks for the room-exit event.
    self._onLeaveRoom(roomId);
  };
    
    
  // delete a chat room.
  Chiselchat.prototype.removeRoom = function(roomId) {
    var self = this;
    self.leaveRoom(roomId);
    self._firebase.child('users').once('value', function (snapshot) {
        var users = snapshot.val();
        for (var userId in users) {
            self._firebase.child('users').child(userId).child(roomId).remove();
        }
    });
    self._messageRef.child(roomId).remove();
    self._firebase.child('room-users').child(roomId).remove();
    self._roomRef.child(roomId).remove();
  };
    

  Chiselchat.prototype.sendMessage = function(roomId, messageContent, messageType, cb) {
    var self = this,
        message = {
          userId: self._userId,
          name: self._userName,
          timestamp: Firebase.ServerValue.TIMESTAMP,
          message: messageContent,
          type: messageType || 'default'
        },
        newMessageRef;

    if (!self._user) {
      self._onAuthRequired();
      if (cb) {
        cb(new Error('Not authenticated or user not set!'));
      }
      return;
    }

    newMessageRef = self._messageRef.child(roomId).push();
    newMessageRef.setWithPriority(message, Firebase.ServerValue.TIMESTAMP, cb);
  };

  Chiselchat.prototype.deleteMessage = function(roomId, messageId, cb) {
    var self = this;
    self._messageRef.child(roomId).child(messageId).remove(cb);
  };

  // Mute or unmute a given user by id. This list will be stored internally and
  // all messages from the muted clients will be filtered client-side after
  // receipt of each new message.
  Chiselchat.prototype.toggleUserMute = function(userId, cb) {
    var self = this;

    if (!self._user) {
      self._onAuthRequired();
      if (cb) {
        cb(new Error('Not authenticated or user not set!'));
      }
      return;
    }

    self._firebase.child('users').child(userId).once('value', function(snapshot) {
        if (!snapshot.val().isModerator) {
            self._userRef.child('muted').child(userId).transaction(function(isMuted) {
              return (isMuted) ? null : true;
            }, cb);
        }
        else {
            cb(new Error('Cannot mute a moderator.'));
        }
    });
  };

  // Send a moderator notification to a specific user.
  Chiselchat.prototype.sendSuperuserNotification = function(userId, notificationType, data, cb) {
    var self = this,
        userNotificationsRef = self._firebase.child('users').child(userId).child('notifications');

    userNotificationsRef.push({
      fromUserId: self._userId,
      timestamp: Firebase.ServerValue.TIMESTAMP,
      notificationType: notificationType,
      data: data || {}
    }, cb);
  };

  // Warn a user for violating the terms of service or being abusive.
  Chiselchat.prototype.warnUser = function(userId) {
    var self = this;

    self.sendSuperuserNotification(userId, 'warning');
  };

  // Suspend a user by putting the user into read-only mode for a period.
  Chiselchat.prototype.suspendUser = function(userId, timeLengthSeconds, cb) {
    var self = this,
        suspendedUntil = new Date().getTime() + 1000*timeLengthSeconds;

    self._suspensionsRef.child(userId).set(suspendedUntil, function(error) {
      if (error && cb) {
        return cb(error);
      } else {
        self.sendSuperuserNotification(userId, 'suspension', {
          suspendedUntil: suspendedUntil
        });
        return cb(null);
      }
    });
  };

  // Invite a user to a specific chat room.
  Chiselchat.prototype.inviteUser = function(userId, roomId) {
    var self = this,
        sendInvite = function() {
          var inviteRef = self._firebase.child('users').child(userId).child('invites').push();
          inviteRef.set({
            id: inviteRef.name(),
            fromUserId: self._userId,
            fromUserName: self._userName,
            roomId: roomId
          });

          // Handle listen unauth / failure in case we're kicked.
          inviteRef.on('value', self._onChiselchatInviteResponse, function(){}, self);
        };

    if (!self._user) {
      self._onAuthRequired();
      return;
    }

    self.getRoom(roomId, function(room) {
      if (room.type === 'private') {
        var authorizedUserRef = self._roomRef.child(roomId).child('authorizedUsers');
        authorizedUserRef.child(userId).set(true, function(error) {
          if (!error) {
            sendInvite();
          }
        });
      } else {
        sendInvite();
      }
    });
  };

  Chiselchat.prototype.acceptInvite = function(inviteId, cb) {
    var self = this;

    self._userRef.child('invites').child(inviteId).once('value', function(snapshot) {
      var invite = snapshot.val();
      if (invite === null && cb) {
        return cb(new Error('acceptInvite(' + inviteId + '): invalid invite id'));
      } else {
        self.enterRoom(invite.roomId);
        self._userRef.child('invites').child(inviteId).update({
          'status': 'accepted',
          'toUserName': self._userName
        }, cb(invite));
      }
    }, self);
  };

  Chiselchat.prototype.declineInvite = function(inviteId, cb) {
    var self = this,
        updates = {
          'status': 'declined',
          'toUserName': self._userName
        };

    self._userRef.child('invites').child(inviteId).update(updates, cb);
  };

  Chiselchat.prototype.getRoomList = function(cb) {
    var self = this;

    self._roomRef.once('value', function(snapshot) {
      cb(snapshot.val());
    });
  };

  Chiselchat.prototype.getUserNameById = function(userId, cb) {
    var self = this;
      self._firebase.child('users').child(userId+'/name').once('value',cb);
  };     

  Chiselchat.prototype.getUsersByRoom = function() {
    var self = this,
        roomId = arguments[0],
        query = self._firebase.child('room-users').child(roomId),
        cb = arguments[arguments.length - 1],
        limit = null;

    if (arguments.length > 2) {
      limit = arguments[1];
    }

    query = (limit) ? query.limit(limit) : query;

    query.once('value', function(snapshot) {
      var usernames = snapshot.val() || {},
          usernamesUnique = {};

      for (var username in usernames) {
        for (var session in usernames[username]) {
          // Skip all other sessions for this user as we only need one.
          usernamesUnique[username] = usernames[username][session];
          break;
        }
      }

      root.setTimeout(function() {
        cb(usernamesUnique);
      }, 0);
    });
  };

  Chiselchat.prototype.getUsersByPrefix = function(prefix, startAt, endAt, limit, cb) {
    var self = this,
        query = this._usersOnlineRef,
        prefixLower = prefix.toLowerCase();

    if (startAt) {
      query = query.startAt(null, startAt);
    } else if (endAt) {
      query = query.endAt(null, endAt);
    } else {
      query = (prefixLower) ? query.startAt(null, prefixLower) : query.startAt();
    }

    query = (limit) ? query.limit(limit) : query;

    query.once('value', function(snapshot) {
      var usernames = snapshot.val() || {},
          usernamesFiltered = {};

      for (var userNameKey in usernames) {
        var sessions = usernames[userNameKey],
            userName, userId, usernameClean;

        // Grab the user data from the first registered active session.
        for (var sessionId in sessions) {
          userName = sessions[sessionId].name;
          userId = sessions[sessionId].id;

          // Skip all other sessions for this user as we only need one.
          break;
        }

        // Filter out any usernames that don't match our prefix and break.
        if ((prefix.length > 0) && (userName.toLowerCase().indexOf(prefixLower) !== 0))
          continue;

        usernamesFiltered[userName] = {
          name: userName,
          id: userId
        };
      }

      root.setTimeout(function() {
        cb(usernamesFiltered);
      }, 0);
    });
  };

  // Miscellaneous helper methods.
  Chiselchat.prototype.getRoom = function(roomId, callback) {
    this._roomRef.child(roomId).once('value', function(snapshot) {
      callback(snapshot.val());
    });
  };

  Chiselchat.prototype.userIsModerator = function() {
    return this._isModerator;
  };
  Chiselchat.prototype.userIsStaff = function() {
    return this._isStaff;
  };
})(Firebase);
