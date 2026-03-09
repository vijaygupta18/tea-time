import { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import Modal from './ui/Modal';
import { useModal } from '../hooks/useModal';
import AddUserModal from './AddUserModal';
import { useAddUserModal } from '../hooks/useAddUserModal';
import { useAuth } from '../hooks/useAuth';
import { resolvePrice, type DrinkPrice } from '../utils';

interface User {
  id: string;
  name: string;
  last_ordered_drink: string;
  last_sugar_level: string;
  profile_picture_url?: string;
  roles: string[];
  isActive: boolean;
  drink_count: number;
  total_drinks_bought: number;
}

interface Order {
  user_id: string;
  drink_type: string;
  sugar_level: string;
}

interface OrderFormProps {
  session: {
    id: string;
  };
  orders: Order[];
  users: User[];
  onOrderUpdate?: () => void;
}

const LONG_PRESS_DURATION = 2000; // 2 seconds

const OrderForm = ({ session, orders, users, onOrderUpdate }: OrderFormProps) => {
  const { profile } = useAuth();
  const [selectedUser, setSelectedUser] = useState('');
  const [drinkType, setDrinkType] = useState('Tea');
  const [sugarLevel, setSugarLevel] = useState('Normal');
  const [isExcused, setIsExcused] = useState(false);
  const [drinkPrices, setDrinkPrices] = useState<DrinkPrice[]>([]);
  const { isOpen, config, onConfirm, closeModal, showError, showSuccess, showConfirm } = useModal();
  const { isModalOpen, openModal, closeModal: closeAddUserModal } = useAddUserModal();
  const [kettleClicks, setKettleClicks] = useState(0);
  const drinkSectionRef = useRef<HTMLDivElement>(null);
  const topOfPageRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const longPressTriggeredRef = useRef(false);
  const [showUserStats, setShowUserStats] = useState<User | null>(null);

  useEffect(() => {
    supabase.from('drink_prices').select('*').then(({ data }) => {
      if (data) setDrinkPrices(data as DrinkPrice[]);
    });
  }, []);

  useEffect(() => {
    if (selectedUser) {
      const existingOrder = orders.find((o) => o.user_id === selectedUser);
      if (existingOrder) {
        setDrinkType(existingOrder.drink_type || 'Tea');
        setSugarLevel(existingOrder.sugar_level || 'Normal');
      } else {
        const user = users.find((u) => u.id === selectedUser);
        if (user) {
          setDrinkType(user.last_ordered_drink || 'Tea');
          setSugarLevel(user.last_sugar_level || 'Normal');
        }
      }
    } else {
      // Reset to default when no user is selected
      setDrinkType('Tea');
      setSugarLevel('Normal');
    }
  }, [selectedUser, users, orders]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) {
      showError('Selection Required', 'Please select your name before placing an order.');
      return;
    }

    const isUpdating = submittedUsers.includes(selectedUser);
    if (isUpdating && !(profile?.permissions.includes('can_update_order') || profile?.id === selectedUser)) {
      showError('Permission Denied', 'You do not have permission to update this order.');
      return;
    }
    
    const { error } = await supabase.from('orders').upsert(
      {
        session_id: session.id,
        user_id: selectedUser,
        drink_type: drinkType,
        sugar_level: sugarLevel,
        is_excused: isExcused,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'session_id,user_id' }
    );

    if (error) {
      console.error('Error submitting order:', error);
      showError('Order Failed', 'Could not submit your order. Please try again.');
      return;
    }

    localStorage.setItem('tea-time-user', selectedUser);
    setSelectedUser('');
    setDrinkType('Tea');
    setSugarLevel('Normal');
    setIsExcused(false);
    
    // Trigger manual refresh if real-time doesn't work
    if (onOrderUpdate) {
      onOrderUpdate();
    }

    // Scroll to top after submission
    setTimeout(() => {
      topOfPageRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100); // A small delay to ensure the scroll happens after the re-render
  };

  const submittedUsers = orders.map((order) => order.user_id);
  const totalUsers = users.length;
  const hasSubmitted = submittedUsers.includes(selectedUser);

  const handleUserSelect = (userId: string) => {
    setSelectedUser(userId);
    // Scroll to the drink selection section
    setTimeout(() => {
      drinkSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100); // A small delay to ensure the section is rendered
  };

  const handleKettleClick = () => {
    const newClicks = kettleClicks + 1;
    setKettleClicks(newClicks);
    if (newClicks >= 5) {
      openModal();
      setKettleClicks(0); // Reset after opening
    }
  };

  const handleRevokeOrder = async () => {
    if (!selectedUser) {
      showError('Selection Required', 'Please select your name first.');
      return;
    }

    showConfirm(
      'Cancel Order?',
      'Are you sure you want to cancel your order? You can always place a new one.',
      async () => {


    
        const { error } = await supabase.from('orders').delete().match({ session_id: session.id, user_id: selectedUser });
        
        if (error) {
          console.error('Error revoking order:', error);
          showError('Cancellation Failed', 'Could not cancel your order. Please try again.');
          return;
        }

        setSelectedUser('');
        setDrinkType('Tea');
        setSugarLevel('Normal');
        setIsExcused(false);
        
        // Trigger manual refresh if real-time doesn't work
        if (onOrderUpdate) {
          onOrderUpdate();
        }
        
        showSuccess('Order Cancelled', 'Your order has been successfully cancelled.');
        
        // Scroll to top after cancellation
        setTimeout(() => {
          topOfPageRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      },
      'Cancel Order',
      'Keep Order'
    );
  };

  const handleDisableUser = async (userId: string, userName: string, isCurrentlyActive: boolean) => {
    if (!profile?.permissions.includes('can_disable_user')) {
      showError('Permission Denied', 'You do not have permission to manage user status.');
      return;
    }

    const isDisabling = isCurrentlyActive;
    const action = isDisabling ? 'Disable' : 'Enable';
    const newStatus = !isCurrentlyActive;
    
    showConfirm(
      `${action} User?`,
      isDisabling 
        ? `Are you sure you want to disable ${userName}? They will no longer appear in leaderboards and cannot place orders.`
        : `Are you sure you want to enable ${userName}? They will reappear in leaderboards and be able to place orders.`,
      async () => {
        const { error } = await supabase
          .from('users')
          .update({ isActive: newStatus })
          .eq('id', userId);

        if (error) {
          console.error(`Error ${action.toLowerCase()}ing user:`, error);
          showError(`${action} Failed`, `Could not ${action.toLowerCase()} ${userName}. Please try again.`);
          return;
        }

        showSuccess(
          `User ${action}d`, 
          isDisabling 
            ? `${userName} has been disabled and will no longer appear in leaderboards.`
            : `${userName} has been enabled and can now participate again.`
        );
        
        // Trigger refresh
        if (onOrderUpdate) {
          onOrderUpdate();
        }
      },
      `${action} User`,
      'Cancel'
    );
  };

  const handleLongPressStart = (userId: string) => {
    if (!profile?.permissions.includes('can_disable_user')) return;
    
    const user = users.find(u => u.id === userId);
    if (!user) return;

    longPressTriggeredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      handleDisableUser(userId, user.name, user.isActive);
    }, LONG_PRESS_DURATION);
  };

  const handleLongPressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleUserTileClick = (userId: string, isActive: boolean) => {
    // Clear any long press timer on click
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    
    // If long press was triggered, don't handle the click
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    
    if (isActive) {
      // Allow selection for active users
      handleUserSelect(userId);
    } else {
      // Show stats for retired users
      const user = users.find(u => u.id === userId);
      if (user) {
        setShowUserStats(user);
      }
    }
  };

  return (
    <div ref={topOfPageRef} className="space-y-10">
      {/* Progress Header */}
      <div className="text-center space-y-4">
        <div className="relative inline-block" onClick={handleKettleClick} style={{ cursor: 'pointer' }}>
          <div className="absolute -inset-2 bg-gradient-to-r from-secondary-400 to-matcha-400 rounded-full blur opacity-30 animate-pulse-slow"></div>
          <div className="relative w-24 h-24 mx-auto">
            <svg className="w-24 h-24 transform -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="40"
                stroke="rgba(34, 197, 94, 0.2)"
                strokeWidth="8"
                fill="none"
              />
              <circle
                cx="50"
                cy="50"
                r="42"
                stroke="url(#progress-gradient)"
                strokeWidth="8"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${(submittedUsers.length / totalUsers) * 251.2} 251.2`}
                className="transition-all duration-700 ease-out"
              />
              <defs>
                <linearGradient id="progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#22c55e" />
                  <stop offset="100%" stopColor="#84cc16" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xl font-bold text-gray-800">
                {submittedUsers.length}/{totalUsers}
              </span>
            </div>
          </div>
        </div>
        
        {/* Order Status Text */}
        <div className="text-center">
          <div className="text-lg sm:text-xl font-bold text-gray-800 mb-1">
            {submittedUsers.length === totalUsers ? '🎉 Everyone has submitted!' : 
             submittedUsers.length > totalUsers / 2 ? '🔥 Most people have submitted' :
             submittedUsers.length > 0 ? '⏳ Waiting for more submissions...' :
             '📝 No orders yet'}
          </div>
          <div className="text-sm sm:text-base text-gray-600">
            {submittedUsers.length} of {totalUsers} people have submitted their orders
          </div>
        </div>
        
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Place Your Order</h2>
        <p className="text-gray-700 text-sm sm:text-base font-medium">Choose your perfect brew for this tea time</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8">
        {/* Compact User Selection */}
        <div className="space-y-3 sm:space-y-4 animate-slide-up">
          <div className="text-center">
            <label className="flex items-center justify-center text-base sm:text-lg font-bold text-gray-800 mb-1">
              <span className="mr-2 text-xl sm:text-2xl">👤</span>
              Select Your Name
            </label>
            <p className="text-gray-600 text-xs sm:text-sm">Tap your name to place an order</p>
          </div>
          
          {/* Compact Grid Layout for User Selection */}
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
            {users.sort((a, b) => {
              // Sort active users first, then by name
              if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
              return a.name.localeCompare(b.name);
            }).map((user) => {
              const isSelected = selectedUser === user.id;
              const hasOrdered = submittedUsers.includes(user.id);
              const isDisabled = !user.isActive;
              
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => handleUserTileClick(user.id, user.isActive)}
                  onMouseDown={() => handleLongPressStart(user.id)}
                  onMouseUp={handleLongPressEnd}
                  onMouseLeave={handleLongPressEnd}
                  onTouchStart={() => handleLongPressStart(user.id)}
                  onTouchEnd={handleLongPressEnd}
                  className={`relative p-2 sm:p-3 rounded-lg text-center transition-all duration-300 border-2 min-h-[5rem] sm:min-h-[6rem] flex flex-col items-center justify-center touch-manipulation ${
                    isDisabled
                      ? 'bg-gray-200 border-gray-300 text-gray-500 cursor-not-allowed opacity-60'
                      : isSelected
                      ? 'bg-gradient-to-br from-green-500 to-green-600 text-white border-green-600 shadow-lg scale-105'
                      : hasOrdered
                      ? 'bg-blue-50 border-blue-300 text-blue-800 hover:bg-blue-100 active:bg-blue-200'
                      : 'bg-white border-gray-200 text-gray-800 hover:border-green-300 hover:bg-green-50 active:bg-green-100'
                  }`}
                >
                  {/* Retired stamp for disabled users */}
                  {isDisabled && (
                    <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                      <span className="bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full border-2 border-red-600 shadow-lg transform -rotate-12 uppercase tracking-wider">
                        Retired
                      </span>
                    </div>
                  )}
                  
                  {user.roles.includes('admin') && (
                    <div className="absolute top-1 right-1 text-yellow-400">
                      👑
                    </div>
                  )}
                  {hasOrdered && !isSelected && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                      ✓
                    </div>
                  )}
                  <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center mb-1 overflow-hidden ${isDisabled ? 'bg-gray-300' : ''}`}>
                    {user.profile_picture_url ? (
                      <img src={user.profile_picture_url} alt={user.name} className={`w-full h-full object-cover ${isDisabled ? 'grayscale' : ''}`} />
                    ) : (
                      <span className={`text-lg font-bold ${isDisabled ? 'text-gray-400' : ''}`}>{user.name.charAt(0)}</span>
                    )}
                  </div>
                  <div className={`text-xs font-semibold leading-tight text-center ${
                    isSelected ? 'text-white' : hasOrdered ? 'text-blue-800' : isDisabled ? 'text-gray-400' : 'text-gray-800'
                  }`}>
                    {user.name}
                  </div>
                  {isSelected && !isDisabled && (
                    <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-white/20 to-transparent animate-pulse"></div>
                  )}
                </button>
              );
            })}
          </div>
          
          {selectedUser && (
            <div className="text-center p-3 sm:p-4 bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl animate-slide-up shadow-sm">
              <div className="flex items-center justify-center space-x-2">
                <span className="text-green-600 text-lg">📋</span>
                <span className="text-green-700 font-semibold text-sm sm:text-base">
                  Selected: <span className="font-bold text-green-800">{users.find(u => u.id === selectedUser)?.name}</span>
                </span>
                <span className="text-green-600 text-sm">
                  {submittedUsers.includes(selectedUser) ? '🔄 updating' : '✨ new order'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Compact Drink Selection */}
        <div ref={drinkSectionRef} className="space-y-3 sm:space-y-4 animate-slide-up" style={{animationDelay: '0.1s'}}>
          <div className="text-center">
            <label className="flex items-center justify-center text-base sm:text-lg font-bold text-gray-800 mb-1">
              <span className="mr-2 text-xl sm:text-2xl">🍵</span>
              Choose Your Drink
            </label>
            <p className="text-gray-600 text-xs sm:text-sm">Select your perfect beverage</p>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            {[
              { name: 'Tea', emoji: '🍵', popular: true },
              { name: 'Coffee', emoji: '☕', popular: true },
              { name: 'Black Coffee', emoji: '☕' },
              { name: 'Black Tea', emoji: '🍵' },
              { name: 'Lemon Tea', emoji: '🍋' },
              { name: 'Plain Milk', emoji: '🥛' },
              { name: 'Badam Milk', emoji: '🥛' },
            ].map((drink) => (
              <button
                key={drink.name}
                type="button"
                onClick={() => setDrinkType(drink.name)}
                className={`relative p-3 sm:p-4 rounded-lg text-center transition-all duration-300 group border-2 min-h-[4rem] sm:min-h-[5rem] flex flex-col items-center justify-center touch-manipulation shadow-sm hover:shadow-lg ${
                  drinkType === drink.name
                    ? 'bg-gradient-to-br from-green-500 to-green-600 text-white shadow-lg scale-105 border-green-600 ring-2 ring-green-200 ring-offset-2'
                    : 'bg-gradient-to-br from-white to-gray-50 hover:bg-green-50 hover:scale-105 active:bg-green-100 border-gray-200 hover:border-green-300 shadow-md'
                }`}
              >
                {drink.popular && (
                  <div className="absolute -top-1 -right-1 bg-orange-500 text-white text-xs px-1 py-0.5 rounded-full font-bold">
                    🔥
                  </div>
                )}
                <div className="text-xl sm:text-2xl mb-1 group-hover:animate-bounce">{drink.emoji}</div>
                <div className={`font-semibold text-xs sm:text-sm ${drinkType === drink.name ? 'text-white' : 'text-gray-800'}`}>
                  {drink.name}
                </div>
                {drinkType === drink.name && (
                  <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-white/20 to-transparent animate-pulse"></div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Compact Sugar Selection */}
        <div className="space-y-3 sm:space-y-4 animate-slide-up" style={{animationDelay: '0.2s'}}>
          <div className="text-center">
            <label className="flex items-center justify-center text-base sm:text-lg font-bold text-gray-800 mb-1">
              <span className="mr-2 text-xl sm:text-2xl">🍯</span>
              Sugar Preference
            </label>
            <p className="text-gray-600 text-xs sm:text-sm">How sweet do you like it?</p>
          </div>
          
          <div className="grid grid-cols-3 gap-2">
            {[
              { level: 'No Sugar', emoji: '🚫', color: 'accent' },
              { level: 'Less', emoji: '🤏🏽', color: 'secondary' },
              { level: 'Normal', emoji: '🍯', color: 'primary' }
            ].map((sugar) => (
              <button
                key={sugar.level}
                type="button"
                onClick={() => setSugarLevel(sugar.level)}
                className={`relative px-3 sm:px-4 py-3 sm:py-4 rounded-lg font-semibold transition-all duration-300 group border-2 min-h-[3.5rem] sm:min-h-[4rem] flex flex-col items-center justify-center touch-manipulation shadow-sm hover:shadow-lg ${
                  sugarLevel === sugar.level
                    ? 'bg-gradient-to-br from-green-500 to-green-600 text-white shadow-lg scale-105 border-green-600 ring-2 ring-green-200 ring-offset-2'
                    : 'bg-gradient-to-br from-white to-gray-50 hover:bg-green-50 hover:scale-105 active:bg-green-100 border-gray-200 hover:border-green-300 shadow-md'
                }`}
              >
                <div className="text-lg sm:text-xl mb-1 group-hover:animate-bounce">{sugar.emoji}</div>
                <div className={`text-xs font-semibold text-center ${sugarLevel === sugar.level ? 'text-white' : 'text-gray-800'}`}>
                  {sugar.level}
                </div>
                {sugarLevel === sugar.level && (
                  <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-white/20 to-transparent animate-pulse"></div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Price preview */}
        {drinkPrices.length > 0 && (
          <div className="text-center py-2">
            <span className="inline-block bg-green-50 border border-green-200 rounded-full px-4 py-1 text-sm font-semibold text-green-800">
              💰 Price: ₹{resolvePrice(drinkType, sugarLevel, drinkPrices)}
            </span>
          </div>
        )}

        {/* Enhanced Mobile-Friendly Action Buttons */}
        <div className="space-y-6 pt-8 animate-slide-up" style={{animationDelay: '0.3s'}}>
          <div className="flex flex-col gap-4">
            <button
              type="submit"
              disabled={!selectedUser}
              className={`w-full py-4 sm:py-5 px-6 text-lg sm:text-xl font-bold rounded-2xl transition-all duration-300 touch-manipulation shadow-lg hover:shadow-xl ${
                !selectedUser 
                  ? 'bg-gradient-to-r from-gray-300 to-gray-400 text-gray-500 cursor-not-allowed shadow-md' 
                  : 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-lg hover:from-green-600 hover:to-green-700 hover:scale-105 active:scale-95 ring-2 ring-green-200 ring-offset-2'
              }`}
            >
              <span className="flex items-center justify-center">
                <span className="mr-3 text-2xl">
                  {!selectedUser ? '❌' : hasSubmitted ? '🔄' : '✅'}
                </span>
                {!selectedUser ? 'Select a Name First' : hasSubmitted ? 'Update Order' : 'Submit Order'}
              </span>
            </button>
            
            {hasSubmitted && (profile?.permissions.includes('can_cancel_order') || profile?.id === selectedUser) && (
              <button
                type="button"
                onClick={handleRevokeOrder}
                className="w-full py-4 sm:py-5 px-6 text-lg sm:text-xl font-bold text-white bg-gradient-to-r from-red-500 to-red-600 rounded-2xl hover:from-red-600 hover:to-red-700 hover:scale-105 active:scale-95 transition-all duration-300 shadow-lg hover:shadow-xl touch-manipulation ring-2 ring-red-200 ring-offset-2"
              >
                <span className="flex items-center justify-center">
                  <span className="mr-3 text-2xl">🗑️</span>
                  Cancel My Order
                </span>
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Modal System */}
      {config && (
        <Modal
          isOpen={isOpen}
          onClose={closeModal}
          title={config.title}
          message={config.message}
          type={config.type}
          showCancel={config.showCancel}
          onConfirm={onConfirm || (() => {})}
          confirmText={config.confirmText}
          cancelText={config.cancelText}
        />
      )}

      <AddUserModal
        isOpen={isModalOpen}
        onClose={closeAddUserModal}
        onUserAdded={() => {
          if (onOrderUpdate) {
            onOrderUpdate();
          }
        }}
      />

      {/* User Stats Modal */}
      {showUserStats && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowUserStats(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-6">
              <div className="text-4xl mb-2">📊</div>
              <h3 className="text-xl font-bold text-gray-800">{showUserStats.name}&apos;s Tea Stats</h3>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-blue-50 rounded-xl p-4 text-center">
                <div className="text-3xl mb-1">🍵</div>
                <div className="text-2xl font-bold text-blue-600">{showUserStats.drink_count}</div>
                <div className="text-xs text-blue-700 font-medium">Drinks Consumed</div>
              </div>
              
              <div className="bg-green-50 rounded-xl p-4 text-center">
                <div className="text-3xl mb-1">☕</div>
                <div className="text-2xl font-bold text-green-600">{showUserStats.total_drinks_bought}</div>
                <div className="text-xs text-green-700 font-medium">Drinks Sponsored</div>
              </div>
            </div>
            
            <button
              onClick={() => setShowUserStats(null)}
              className="w-full py-3 px-4 bg-gradient-to-r from-gray-500 to-gray-600 text-white font-semibold rounded-xl hover:from-gray-600 hover:to-gray-700 transition-all duration-200 shadow-lg"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderForm;
