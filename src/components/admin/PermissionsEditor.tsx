import { useMemo } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { 
  SectionPermissions, 
  ALL_PERMISSION_KEYS, 
  PERMISSION_LABELS,
  ROLE_DEFAULT_PERMISSIONS,
  AdminRole 
} from '@/hooks/useAdminPermissions';

interface PermissionsEditorProps {
  permissions: SectionPermissions;
  onChange: (permissions: SectionPermissions) => void;
  disabled?: boolean;
  isSuperAdmin?: boolean;
}

export function PermissionsEditor({ 
  permissions, 
  onChange, 
  disabled = false,
  isSuperAdmin = false 
}: PermissionsEditorProps) {
  // Group permissions by category
  const groupedPermissions = useMemo(() => {
    const groups: Record<string, (keyof SectionPermissions)[]> = {};
    ALL_PERMISSION_KEYS.forEach(key => {
      const category = PERMISSION_LABELS[key].category;
      if (!groups[category]) groups[category] = [];
      groups[category].push(key);
    });
    return groups;
  }, []);

  const handleToggle = (key: keyof SectionPermissions, checked: boolean) => {
    onChange({ ...permissions, [key]: checked });
  };

  const categoryOrder = ['Core', 'Experiments & Analytics', 'Payments & Shipping', 'Support & Knowledge', 'Admin & Settings'];

  return (
    <div className="space-y-4">
      {categoryOrder.map(category => (
        <div key={category} className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">{category}</h4>
          <div className="grid grid-cols-2 gap-2">
            {groupedPermissions[category]?.map(key => {
              const isChecked = isSuperAdmin ? true : permissions[key];
              const isDisabled = disabled || isSuperAdmin;
              
              return (
                <div key={key} className="flex items-center space-x-2">
                  <Checkbox
                    id={key}
                    checked={isChecked}
                    onCheckedChange={(checked) => handleToggle(key, checked === true)}
                    disabled={isDisabled}
                  />
                  <Label 
                    htmlFor={key} 
                    className={`text-sm cursor-pointer ${isDisabled ? 'text-muted-foreground' : ''}`}
                  >
                    {PERMISSION_LABELS[key].label}
                  </Label>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      
      {isSuperAdmin && (
        <p className="text-xs text-muted-foreground italic">
          Super Admin always has full access to all sections.
        </p>
      )}
    </div>
  );
}

// Helper to apply role defaults to permissions
export function applyRoleDefaults(role: AdminRole): SectionPermissions {
  return { ...ROLE_DEFAULT_PERMISSIONS[role] };
}

// Permission summary badge component
export function PermissionsSummaryBadges({ permissions }: { permissions: SectionPermissions }) {
  const enabledSections: string[] = [];
  
  if (permissions.can_view_orders) enabledSections.push('Orders');
  if (permissions.can_view_active_carts || permissions.can_view_saved_carts) enabledSections.push('Carts');
  if (permissions.can_view_payments) enabledSections.push('Payments');
  if (permissions.can_view_shipping) enabledSections.push('Shipping');
  if (permissions.can_view_tickets) enabledSections.push('Support');
  if (permissions.can_view_analytics) enabledSections.push('Analytics');
  if (permissions.can_manage_users) enabledSections.push('Users');
  
  if (enabledSections.length === 0) {
    return <span className="text-xs text-muted-foreground">Dashboard only</span>;
  }
  
  const display = enabledSections.slice(0, 3).join(', ');
  const remaining = enabledSections.length - 3;
  
  return (
    <span className="text-xs text-muted-foreground">
      {display}{remaining > 0 ? `, +${remaining} more` : ''}
    </span>
  );
}
