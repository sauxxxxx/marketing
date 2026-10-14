import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader } from '@/components/common/PageHeader'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { can } from '@/lib/permissions'
import { AccountSettings } from './AccountSettings'
import { WorkspaceSettings } from './WorkspaceSettings'
import { BrandSettings } from './BrandSettings'
import { ConfigSettings } from './ConfigSettings'
import { KeyDateSettings } from './KeyDateSettings'
import { AuditLog } from './AuditLog'

const ADMIN_TABS = ['workspace', 'brands', 'formats', 'key-dates', 'audit'] as const

export default function SettingsPage() {
  const { role } = useActiveWorkspace()
  const [params, setParams] = useSearchParams()
  const isAdmin = can(role, 'settings.manage')
  const requested = params.get('tab') ?? 'account'
  const tab = requested === 'account' || (isAdmin && (ADMIN_TABS as readonly string[]).includes(requested)) ? requested : 'account'

  return (
    <div className="flex flex-col">
      <PageHeader title="Settings" description={isAdmin ? 'Your account and workspace configuration.' : 'Your account.'} />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })} className="gap-4 p-3 md:p-4">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="account">Account</TabsTrigger>
          {isAdmin && (
            <>
              <TabsTrigger value="workspace">Workspace</TabsTrigger>
              <TabsTrigger value="brands">Brands</TabsTrigger>
              <TabsTrigger value="formats">Formats & pillars</TabsTrigger>
              <TabsTrigger value="key-dates">Key dates</TabsTrigger>
              <TabsTrigger value="audit">Audit history</TabsTrigger>
            </>
          )}
        </TabsList>
        <TabsContent value="account">
          <AccountSettings />
        </TabsContent>
        {isAdmin && (
          <>
            <TabsContent value="workspace">
              <WorkspaceSettings />
            </TabsContent>
            <TabsContent value="brands">
              <BrandSettings />
            </TabsContent>
            <TabsContent value="formats">
              <ConfigSettings />
            </TabsContent>
            <TabsContent value="key-dates">
              <KeyDateSettings />
            </TabsContent>
            <TabsContent value="audit">
              <AuditLog />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  )
}
