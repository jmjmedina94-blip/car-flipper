/**
 * Role-based access control middleware for Car Flipper
 * Roles: 'owner' > 'admin' > 'bdc_rep'
 */

const ROLE_LEVELS = { owner: 3, admin: 2, bdc_rep: 1, member: 1 };

/**
 * requireRole('owner') — only owners
 * requireRole('admin') — admins and owners
 * requireRole('bdc_rep') — all authenticated users
 */
function requireRole(...roles) {
  return (req, res, next) => {
    const userRole = req.user?.role || 'bdc_rep';
    const userLevel = ROLE_LEVELS[userRole] || 1;
    const minLevel = Math.min(...roles.map(r => ROLE_LEVELS[r] || 1));
    if (userLevel >= minLevel) return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}

/**
 * Attach full user record to req.fullUser (for permission checks)
 */
function attachUserPermissions(db) {
  return async (req, res, next) => {
    if (!req.user?.userId) return next();
    try {
      const r = await db.query(
        'SELECT role, can_view_all_leads, can_view_dealer_inventory FROM users WHERE id = $1',
        [req.user.userId]
      );
      if (r.rows[0]) {
        req.user.role = r.rows[0].role;
        req.user.can_view_all_leads = r.rows[0].can_view_all_leads;
        req.user.can_view_dealer_inventory = r.rows[0].can_view_dealer_inventory;
      }
    } catch (e) { /* non-fatal */ }
    next();
  };
}

function isOwner(req) { return req.user?.role === 'owner'; }
function isAdmin(req) { return ['owner','admin'].includes(req.user?.role); }
function isBdcRep(req) { return req.user?.role === 'bdc_rep' || req.user?.role === 'member'; }
function canViewAllLeads(req) { return isAdmin(req) || req.user?.can_view_all_leads; }
function canViewDealerInventory(req) { return isAdmin(req) || req.user?.can_view_dealer_inventory; }

module.exports = { requireRole, attachUserPermissions, isOwner, isAdmin, isBdcRep, canViewAllLeads, canViewDealerInventory, ROLE_LEVELS };
