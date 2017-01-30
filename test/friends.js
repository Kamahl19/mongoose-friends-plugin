const mongoose = require('mongoose');
const friendsPlugin = require('../dist/plugin');
const Status = friendsPlugin.Status;
const assert = require('assert');
const should = require('should');

require('dotenv').config();

mongoose.Promise = global.Promise;

mongoose.connect(process.env.MONGODB_TEST);

const UserSchema = new mongoose.Schema({
  name: String,
});

const collectionName = 'friendtestusers';
const pathName = 'friends';

UserSchema.plugin(friendsPlugin({ pathName }));

const User = mongoose.model('User', UserSchema, collectionName);

suite('friends', function() {
  let u1;
  let u2;

  function ensureUsers() {
    u1 = new User({ name: 'Alice' });
    u2 = new User({ name: 'Roger' });

    return User.remove()
      .then(() => User.create([u1, u2]));
  }

  setup(() => {
    return ensureUsers();
  });

  suite('requesting friends', function() {
    suite('.requestFriend', function() {
      setup(function() {
        return User.requestFriend(u1, u2, 'test');
      });

      // test the basic behavior
      requestFriendBehavior();

      test('request by requested should accept friendship on both sides', function() {
        return User.requestFriend(u2, u1, 'test')
          .then((fships) => {
            fships.friender.status.should.eql(Status.Accepted);
            fships.friender.data.should.eql('test');
          })
          .then(() => User.findById(u1._id, pathName))
          .then((doc) => {
            doc[pathName].id(u2.id).status.should.eql(Status.Accepted);
            doc[pathName].id(u2.id).data.should.eql('test');
          })
          .then(() => User.findById(u2._id, pathName))
          .then((doc) => {
            doc[pathName].id(u1.id).status.should.eql(Status.Accepted);
            doc[pathName].id(u1.id).data.should.eql('test');
          });
      });

      test('requesting a 2nd time should have no effect', function() {
        return User.requestFriend(u1, u2)
          .then((fships) => {
            fships.friender.status.should.eql(Status.Requested);
          })
          .then(() => User.findById(u2._id, pathName))
          .then((doc) => {
            doc[pathName].length.should.eql(1);
            doc[pathName].id(u1._id).status.should.eql(Status.Pending);
          })
      });

      suite('when requestee has already accepted', function() {
        setup(function() {
          var query = {_id: u2._id};
          query[pathName] = {$elemMatch: {_id: u1._id}};

          var update = {$set: {}};
          update.$set[pathName+'.$.status'] = Status.Accepted;

          return User.findOneAndUpdate(query, update);
        });

        test('re-requesting should accept friendship on both sides', function() {
          return User.requestFriend(u1, u2)
            .then((fships) => {
              fships.friender.status.should.eql(Status.Accepted);
            })
            .then(() => User.findById(u1._id, pathName))
            .then((doc) => {
              doc[pathName].id(u2.id).status.should.eql(Status.Accepted);
            })
            .then(() => User.findById(u2._id, pathName))
            .then((doc) => {
              doc[pathName].id(u1.id).status.should.eql(Status.Accepted);
            });
        });
      });

      suite('when requestee has requested requester', function() {
        setup(function() {
          var query = {_id: u2._id};
          query[pathName] = {$elemMatch: {_id: u1._id}};

          var update = {$set: {}};
          update.$set[pathName+'.$.status'] = Status.Requested;

          return User.findOneAndUpdate(query, update);
        });

        test('re-requesting should accept friendship on both sides', function() {
          return User.requestFriend(u1, u2)
            .then((fships) => {
              fships.friender.status.should.eql(Status.Accepted);
            })
            .then(() => User.findById(u1._id, pathName))
            .then((doc) => {
              doc[pathName].id(u2.id).status.should.eql(Status.Accepted);
            })
            .then(() => User.findById(u2._id, pathName))
            .then((doc) => {
              doc[pathName].id(u1.id).status.should.eql(Status.Accepted);
            });
        });
      });
    });

    suite('#requestFriend', function() {
      setup(function() {
        return u1.requestFriend(u2, 'test');
      });

      requestFriendBehavior();
    });

    function requestFriendBehavior() {
      test('requester should have requested friend request', function() {
        return User.findById(u1._id, pathName)
          .then((doc) => {
            doc[pathName].id(u2.id).status.should.eql(Status.Requested);
            doc[pathName].id(u2.id).data.should.eql('test');
          });
      });

      test('requestee should have pending friend request', function() {
        return User.findById(u2._id, pathName)
          .then((doc) => {
            doc[pathName].id(u1.id).status.should.eql(Status.Pending);
            doc[pathName].id(u1.id).data.should.eql('test');
          });
      });
    }
  });

  suite('getting friends', function() {
    setup(function() {
      return User.requestFriend(u1, u2);
    });

    suite('.getFriends', function() {
      getFriendBehavior(true);
    });

    suite('#getFriends', function() {
      getFriendBehavior();
    });

    suite('status helpers', function() {
      function check(type, user, len, instance) {
        return function() {
          user = user ? u1 : u2;

          if (instance) {
            return user[`get${type}Friends`]()
              .then((friends) => {
                friends.length.should.eql(len);
              });
          }
          else {
            return User[`get${type}Friends`](user)
              .then((friends) => {
                friends.length.should.eql(len);
              });
          }
        }
      }

      suite('after request', function() {
        suite('.getPendingFriends', function() {
          test('requester should have 0', check('Pending', 1, 0));
          test('requestee should have 1', check('Pending', 0, 1));
        });
        suite('#getPendingFriends', function() {
          test('requester should have 0', check('Pending', 1, 0, 1));
          test('requestee should have 1', check('Pending', 0, 1, 1));
        });
        suite('.getAcceptedFriends', function() {
          test('requester should have 0', check('Accepted', 1, 0));
          test('requestee should have 0', check('Accepted', 0, 0));
        });
        suite('#getAcceptedFriends', function() {
          test('requester should have 0', check('Accepted', 1, 0, 1));
          test('requestee should have 0', check('Accepted', 0, 0, 1));
        });
        suite('.getRequestedFriends', function() {
          test('requester should have 1', check('Requested', 1, 1));
          test('requestee should have 0', check('Requested', 0, 0));
        })
        suite('#getRequestedFriends', function() {
          test('requester should have 1', check('Requested', 1, 1, 1));
          test('requestee should have 0', check('Requested', 0, 0, 1));
        });
      });

      suite('after reciprocation', function() {
        setup(function() {
          return User.requestFriend(u2, u1);
        });
        suite('.getPendingFriends', function() {
          test('requester should have 0', check('Pending', 1, 0));
          test('requestee should have 0', check('Pending', 0, 0));
        });
        suite('#getPendingFriends', function() {
          test('requester should have 0', check('Pending', 1, 0, 1));
          test('requestee should have 0', check('Pending', 0, 0, 1));
        });
        suite('.getAcceptedFriends', function() {
          test('requester should have 1', check('Accepted', 1, 1));
          test('requestee should have 1', check('Accepted', 0, 1));
        });
        suite('#getAcceptedFriends', function() {
          test('requester should have 1', check('Accepted', 1, 1, 1));
          test('requestee should have 1', check('Accepted', 0, 1, 1));
        });
        suite('.getRequestedFriends', function() {
          test('requester should have 0', check('Requested', 1, 0));
          test('requestee should have 0', check('Requested', 0, 0));
        });
        suite('#getRequestedFriends', function() {
          test('requester should have 0', check('Requested', 1, 0, 1));
          test('requestee should have 0', check('Requested', 0, 0, 1));
        });
      });
    });

    suite('sorting & limiting', function() {
      let u3, u4, u5, u6;

      const reciprocate = function(a, b) {
        return a.requestFriend(b)
          .then(() => b.requestFriend(a));
      }

      const request = function(a, b) {
        return a.requestFriend(b);
      }

      setup(function() {
        u3 = new User({ name: 'Zeke' });
        u4 = new User({ name: 'Beatrice' });
        u5 = new User({ name: 'Dan' });
        u6 = new User({ name: 'Norm' });

        return User.create([u3, u4, u5, u6])
          .then(() => {
            return Promise.all([
              reciprocate(u1, u2),
              reciprocate(u1, u3),
              reciprocate(u1, u4),
              request(u1, u5),
              request(u1, u6),
              reciprocate(u5, u6),
              request(u5, u4),
            ]);
          })
          .then(() => {
            return User.getFriends(u1)
              .then((friends) => {
                friends.length.should.eql(5);
              });
          });
      });

      test('status condition (Accepted)', function() {
        const conditions = {
          [`${pathName}.status`]: Status.Accepted,
        };

        return u1.getFriends({ conditions })
          .then((friends) => {
            friends.length.should.eql(3);
          });
      });

      test('status condition (Requested)', function() {
        const conditions = {
          [`${pathName}.status`]: Status.Requested,
        };

        return u1.getFriends({ conditions })
          .then((friends) => {
            friends.length.should.eql(2);
          });
      });

      test('select fields', function() {
        return u1.getFriends({
          conditions: {_id: u6._id},
          fields: { _id: 1 },
        })
          .then((friends) => {
            should.not.exist(friends[0].friend.name);
            friends[0].friend._id.should.eql(u6._id);
          });
      });

      test('limiting', function() {
        return User.getFriends(u1, {
          conditions: {},
          fields: null,
          options: { limit: 2 },
        })
          .then((friends) => {
            friends.length.should.eql(2);
          });
      });

      test('sorting', function() {
        const names = [u2, u3, u4, u5, u6].map((u) => u.name).sort();

        return User.getFriends(u1, {
          conditions: {},
          fields: null,
          options: { sort: { name: 1 } },
        })
          .then((friends) => {
            assert.deepEqual(names, friends.map((fship) => fship.friend.name));
          });
      });
    });

    function getFriendBehavior(isStatic) {
      const shouldHave = function(friend, status, user2) {
        return function() {
          let user;
          let other;

          if (user2) {
            user = u2;
            other = u1;
          }
          else {
            user = u1;
            other = u2;
          }

          const cb = (friends) => {
            if (friend) {
              friends.length.should.eql(1);
              friends[0].friend._id.should.eql(other._id);
            }
            else {
              friends.length.should.eql(0);
            }
          }

          const conditions = {
            [`${pathName}.status`]: status,
          };

          if (isStatic) {
            return User.getFriends(user, {
              conditions,
              fields: null,
              options: { sort: { name: 1 } },
            })
              .then((friends) => cb(friends));
          }
          else {
            return user.getFriends({ conditions })
              .then((friends) => cb(friends));
          }
        }
      }

      suite('after request made', function() {
        suite('requester', function() {
          test('should have 1 requested friend (requestee)', shouldHave(1, Status.Requested));
          test('should have 0 accepted friends', shouldHave(0, Status.Accepted));
          test('should have 0 pending friends', shouldHave(0, Status.Pending));
        });

        suite('requestee', function() {
          test('should have 0 requested friend', shouldHave(0, Status.Requested, 1));
          test('should have 0 accepted friends', shouldHave(0, Status.Accepted, 1));
          test('should have 1 pending friends (requester)', shouldHave(1, Status.Pending, 1));
        });
      });

      suite('after request accepted', function() {
        setup(function() {
          return User.requestFriend(u2, u1);
        });

        suite('requester', function() {
          test('should have 1 accepted friend (requestee)', shouldHave(1, Status.Accepted));
        });

        suite('requestee', function() {
          test('should have 1 accepted friend (requester)', shouldHave(1, Status.Accepted, 1));
        });
      });
    }
  });

  suite('removing friends', function() {
    setup(function() {
      return ensureUsers()
        .then(() => User.requestFriend(u1, u2))
        .then(() => User.requestFriend(u2, u1));
    });

    suite('.removeFriend', function() {
      setup(function() {
        return User.removeFriend(u1, u2);
      });

      removeFriendBehavior();
    });

    suite('#removeFriend', function() {
      setup(function() {
        return u1.removeFriend(u2);
      });

      removeFriendBehavior();
    });

    function removeFriendBehavior() {
      test('remover should have no friendship', function() {
        return User.getFriends(u1)
          .then((friends) => {
            friends.length.should.eql(0);
          });
      });

      test('removee should no longer have friendship', function() {
        return User.getFriends(u2)
          .then((friends) => {
            friends.length.should.eql(0);
          });
      });
    }
  });

  suite('checking friendship', function() {
    test('should not be friends', function() {
      return checkFriendship(false);
    });

    suite('after requesting', function() {
      setup(function() {
        return User.requestFriend(u1, u2);
      });

      test('should not be friends after requesting', function() {
        return checkFriendship(false);
      });
    });

    suite('after accepting', function() {
      setup(function() {
        return User.requestFriend(u1, u2)
          .then(() => User.requestFriend(u2, u1));
      });

      test('should be friends after accepting', function() {
        return checkFriendship(true);
      });
    });

    function checkFriendship(shouldBeFriends) {
      return User.areFriends(u1, u2)
        .then((areFriends) => {
          areFriends.should.eql(shouldBeFriends);
        })
        .then(() => u1.isFriendsWith(u2))
        .then((isFriend) => {
          isFriend.should.eql(shouldBeFriends);
        })
        .then(() => u2.isFriendsWith(u1))
        .then((isFriend2) => {
          isFriend2.should.eql(shouldBeFriends);
        });
    }
  });

  suiteTeardown(function(done) {
    mongoose.connection.db.dropCollection(collectionName, done);
  });
});
