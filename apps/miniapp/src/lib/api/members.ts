import type {
  AdminMembersResponse,
  CreateInvite,
  InviteResponse,
  InvitesResponse,
  Me,
  MemberAction,
  MemberActionResponse,
  MemberStatus,
  UpdateMe,
} from '@agrobot/shared';
import { api } from './client.js';

/** The M1 endpoints of ARCH §11, typed by the shared contracts. */

export const fetchMe = () => api.get<Me>('/me');
export const updateMe = (patch: UpdateMe) => api.patch<Me>('/me', patch);

export const adminListMembers = (status?: MemberStatus) =>
  api.get<AdminMembersResponse>(`/admin/members${status ? `?status=${status}` : ''}`);
export const adminMemberAction = (memberId: string, action: MemberAction) =>
  api.post<MemberActionResponse>(`/admin/members/${memberId}/${action}`);

export const adminListInvites = () => api.get<InvitesResponse>('/admin/invites');
export const adminCreateInvite = (body: CreateInvite) =>
  api.post<InviteResponse>('/admin/invites', body);
export const adminDeleteInvite = (inviteId: string) =>
  api.delete<void>(`/admin/invites/${inviteId}`);
