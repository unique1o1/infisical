import { Controller, useFieldArray, useForm } from "react-hook-form";
import { faCaretDown, faClock, faClose } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatDistance } from "date-fns";
import ms from "ms";
import { twMerge } from "tailwind-merge";
import { z } from "zod";

import { TtlFormLabel } from "@app/components/features";
import { createNotification } from "@app/components/notifications";
import { ProjectPermissionCan } from "@app/components/permissions";
import {
  Button,
  FormControl,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectItem,
  Spinner,
  Tag,
  Tooltip
} from "@app/components/v2";
import {
  ProjectPermissionActions,
  ProjectPermissionSub,
  useProjectPermission,
  useSubscription,
  useWorkspace
} from "@app/context";
import { useGetProjectRoles, useUpdateIdentityWorkspaceRole } from "@app/hooks/api";
import { IdentityMembership } from "@app/hooks/api/identities/types";
import { ProjectMembershipRole } from "@app/hooks/api/roles/types";
import { ProjectUserMembershipTemporaryMode } from "@app/hooks/api/workspace/types";

const roleFormSchema = z.object({
  roles: z
    .object({
      slug: z.string(),
      temporaryAccess: z.discriminatedUnion("isTemporary", [
        z.object({
          isTemporary: z.literal(true),
          temporaryRange: z.string().min(1),
          temporaryAccessStartTime: z.string().datetime(),
          temporaryAccessEndTime: z.string().datetime().nullable().optional()
        }),
        z.object({
          isTemporary: z.literal(false)
        })
      ])
    })
    .array()
});
type TRoleForm = z.infer<typeof roleFormSchema>;

type Props = {
  identityProjectMember: IdentityMembership;
  onOpenUpgradeModal: (title: string) => void;
};
export const IdentityRbacSection = ({ identityProjectMember, onOpenUpgradeModal }: Props) => {
  const { subscription } = useSubscription();
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id || "";
  const { data: projectRoles, isLoading: isRolesLoading } = useGetProjectRoles(workspaceId);
  const { permission } = useProjectPermission();
  const isMemberEditDisabled = permission.cannot(
    ProjectPermissionActions.Edit,
    ProjectPermissionSub.Identity
  );

  const roleForm = useForm<TRoleForm>({
    resolver: zodResolver(roleFormSchema),
    values: {
      roles: identityProjectMember?.roles?.map(({ customRoleSlug, role, ...dto }) => ({
        slug: customRoleSlug || role,
        temporaryAccess: dto.isTemporary
          ? {
            isTemporary: true,
            temporaryRange: dto.temporaryRange,
            temporaryAccessEndTime: dto.temporaryAccessEndTime,
            temporaryAccessStartTime: dto.temporaryAccessStartTime
          }
          : {
            isTemporary: dto.isTemporary
          }
      }))
    }
  });
  const selectedRoleList = useFieldArray({
    name: "roles",
    control: roleForm.control
  });

  const formRoleField = roleForm.watch("roles");

  const updateMembershipRole = useUpdateIdentityWorkspaceRole();

  const handleRoleUpdate = async (data: TRoleForm) => {
    if (updateMembershipRole.isLoading) return;

    const sanitizedRoles = data.roles.map((el) => {
      const { isTemporary } = el.temporaryAccess;
      if (!isTemporary) {
        return { role: el.slug, isTemporary: false as const };
      }
      return {
        role: el.slug,
        isTemporary: true as const,
        temporaryMode: ProjectUserMembershipTemporaryMode.Relative,
        temporaryRange: el.temporaryAccess.temporaryRange,
        temporaryAccessStartTime: el.temporaryAccess.temporaryAccessStartTime
      };
    });

    const hasCustomRoleSelected = sanitizedRoles.some(
      (el) => !Object.values(ProjectMembershipRole).includes(el.role as ProjectMembershipRole)
    );

    if (hasCustomRoleSelected && subscription && !subscription?.rbac) {
      onOpenUpgradeModal(
        "You can assign custom roles to members if you upgrade your Infisical plan."
      );
      return;
    }

    try {
      await updateMembershipRole.mutateAsync({
        workspaceId,
        identityId: identityProjectMember.identity.id,
        roles: sanitizedRoles
      });
      createNotification({ text: "Successfully updated roles", type: "success" });
      roleForm.reset(undefined, { keepValues: true });
    } catch (err) {
      createNotification({ text: "Failed to update role", type: "error" });
    }
  };

  if (isRolesLoading)
    return (
      <div className="flex w-full items-center justify-center p-8">
        <Spinner />
      </div>
    );

  return (
    <div>
      <div className="text-lg font-medium">Roles</div>
      <p className="text-sm text-mineshaft-400">Select one of the pre-defined or custom roles.</p>
      <div>
        <form onSubmit={roleForm.handleSubmit(handleRoleUpdate)}>
          <div className="mt-2 flex flex-col space-y-2">
            {selectedRoleList.fields.map(({ id }, index) => {
              const { temporaryAccess } = formRoleField[index];
              const isTemporary = temporaryAccess?.isTemporary;
              const isExpired =
                temporaryAccess.isTemporary &&
                new Date() > new Date(temporaryAccess.temporaryAccessEndTime || "");

              return (
                <div key={id} className="flex items-center space-x-2">
                  <Controller
                    control={roleForm.control}
                    name={`roles.${index}.slug`}
                    render={({ field: { onChange, ...field } }) => (
                      <Select
                        defaultValue={field.value}
                        {...field}
                        isDisabled={isMemberEditDisabled}
                        onValueChange={(e) => onChange(e)}
                        className="w-full bg-mineshaft-600"
                      >
                        {projectRoles?.map(({ name, slug, id: projectRoleId }) => (
                          <SelectItem value={slug} key={projectRoleId}>
                            {name}
                          </SelectItem>
                        ))}
                      </Select>
                    )}
                  />
                  <Popover>
                    <PopoverTrigger disabled={isMemberEditDisabled}>
                      <Tooltip
                        asChild
                        content={isExpired ? "Timed access expired" : "Grant timed access"}
                      >
                        <Button
                          variant="outline_bg"
                          leftIcon={isTemporary ? <FontAwesomeIcon icon={faClock} /> : undefined}
                          rightIcon={<FontAwesomeIcon icon={faCaretDown} className="ml-2" />}
                          isDisabled={isMemberEditDisabled}
                          className={twMerge(
                            "border-none bg-mineshaft-600 py-2 capitalize",
                            isTemporary && "text-primary",
                            isExpired && "text-red-600"
                          )}
                        >
                          {!temporaryAccess?.isTemporary
                            ? "Permanent"
                            : formatDistance(
                              new Date(temporaryAccess.temporaryAccessEndTime || ""),
                              new Date()
                            )}
                        </Button>
                      </Tooltip>
                    </PopoverTrigger>
                    <PopoverContent
                      arrowClassName="fill-gray-600"
                      side="right"
                      sideOffset={12}
                      hideCloseBtn
                      className="border border-gray-600 pt-4"
                    >
                      <div className="flex flex-col space-y-4">
                        <div className="border-b border-b-gray-700 pb-2 text-sm text-mineshaft-300">
                          Configure timed access
                        </div>
                        {isExpired && <Tag colorSchema="red">Expired</Tag>}
                        <Controller
                          control={roleForm.control}
                          defaultValue="1h"
                          name={`roles.${index}.temporaryAccess.temporaryRange`}
                          render={({ field, fieldState: { error } }) => (
                            <FormControl
                              label={<TtlFormLabel label="Validity" />}
                              isError={Boolean(error?.message)}
                              errorText={error?.message}
                            >
                              <Input {...field} />
                            </FormControl>
                          )}
                        />
                        <div className="flex items-center space-x-2">
                          <Button
                            size="xs"
                            onClick={() => {
                              const temporaryRange = roleForm.getValues(
                                `roles.${index}.temporaryAccess.temporaryRange`
                              );
                              if (!temporaryRange) {
                                roleForm.setError(
                                  `roles.${index}.temporaryAccess.temporaryRange`,
                                  { type: "required", message: "Required" },
                                  { shouldFocus: true }
                                );
                                return;
                              }
                              roleForm.clearErrors(`roles.${index}.temporaryAccess.temporaryRange`);
                              roleForm.setValue(
                                `roles.${index}.temporaryAccess`,
                                {
                                  isTemporary: true,
                                  temporaryAccessStartTime: new Date().toISOString(),
                                  temporaryRange,
                                  temporaryAccessEndTime: new Date(
                                    new Date().getTime() + ms(temporaryRange)
                                  ).toISOString()
                                },
                                { shouldDirty: true }
                              );
                            }}
                          >
                            {temporaryAccess.isTemporary ? "Restart" : "Grant"}
                          </Button>
                          {temporaryAccess.isTemporary && (
                            <Button
                              size="xs"
                              variant="outline_bg"
                              colorSchema="danger"
                              onClick={() => {
                                roleForm.setValue(`roles.${index}.temporaryAccess`, {
                                  isTemporary: false
                                });
                              }}
                            >
                              Revoke Access
                            </Button>
                          )}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Tooltip content={isMemberEditDisabled ? "Access restricted" : "Remove"}>
                    <IconButton
                      variant="outline_bg"
                      className="border-none bg-mineshaft-600 py-3"
                      ariaLabel="delete-role"
                      isDisabled={isMemberEditDisabled}
                      onClick={() => {
                        if (selectedRoleList.fields.length > 1) {
                          selectedRoleList.remove(index);
                        }
                      }}
                    >
                      <FontAwesomeIcon icon={faClose} />
                    </IconButton>
                  </Tooltip>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex justify-between space-x-2">
            <ProjectPermissionCan
              I={ProjectPermissionActions.Edit}
              a={ProjectPermissionSub.Identity}
            >
              {(isAllowed) => (
                <Button
                  variant="outline_bg"
                  isDisabled={!isAllowed}
                  onClick={() =>
                    selectedRoleList.append({
                      slug: ProjectMembershipRole.Member,
                      temporaryAccess: { isTemporary: false }
                    })
                  }
                >
                  Add Role
                </Button>
              )}
            </ProjectPermissionCan>
            <Button
              type="submit"
              className={twMerge(
                "transition-all",
                "opacity-0",
                roleForm.formState.isDirty && "opacity-100"
              )}
              isLoading={roleForm.formState.isSubmitting}
            >
              Save Roles 
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
