import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Shield, DollarSign, Package, Headphones } from 'lucide-react';

interface StaffRoleSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const ADMIN_ROLES = [
  { value: 'super_admin', label: 'Super Admin', icon: Shield, color: 'text-purple-600' },
  { value: 'finance', label: 'Finance', icon: DollarSign, color: 'text-green-600' },
  { value: 'operations', label: 'Operations', icon: Package, color: 'text-blue-600' },
  { value: 'support', label: 'Support', icon: Headphones, color: 'text-orange-600' },
];

export function StaffRoleSelector({ value, onChange, disabled }: StaffRoleSelectorProps) {
  const getRoleBadge = (roleValue: string) => {
    const role = ADMIN_ROLES.find(r => r.value === roleValue);
    if (!role) return null;

    const Icon = role.icon;
    return (
      <Badge variant="outline" className="gap-1.5">
        <Icon className={`h-3 w-3 ${role.color}`} />
        {role.label}
      </Badge>
    );
  };

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-[200px]">
        <SelectValue>
          {getRoleBadge(value) || 'Select role'}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {ADMIN_ROLES.map((role) => {
          const Icon = role.icon;
          return (
            <SelectItem key={role.value} value={role.value}>
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${role.color}`} />
                <span>{role.label}</span>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

export function RoleBadge({ role }: { role: string }) {
  const roleData = ADMIN_ROLES.find(r => r.value === role);
  if (!roleData) return <Badge>Unknown</Badge>;

  const Icon = roleData.icon;
  return (
    <Badge variant="outline" className="gap-1.5">
      <Icon className={`h-3 w-3 ${roleData.color}`} />
      {roleData.label}
    </Badge>
  );
}
