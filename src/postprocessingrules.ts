import { Command } from "./commands";
import { UpdateQuery } from "./types";

export type PostProcessingRuleState = {
    updates: UpdateQuery[];
    commands: Command[];
}

export type PostProcessingRule = {
    process(state: PostProcessingRuleState): PostProcessingRuleState
}

export class DisableToPutParentIdToEmpty implements PostProcessingRule {
    static readonly ERROR_MESSAGE = "That will move the note out of any folder. Operation forbidden. Please validate your kanban rules";

    process(state: PostProcessingRuleState): PostProcessingRuleState {
        const newState = { ...state };

        const disableAllowedQuery = state.updates.find((update: any) => {
            try {
                return update.type === "put"
                && update.body?.parent_id === "";
            } catch (e) {
                return false;
            }
        });

        if (disableAllowedQuery) {
            newState.updates = [];
            newState.commands.push({
                type: "showBanner",
                messages: [{
                    id: "disable-to-put-parent-id-to-empty",
                    title: DisableToPutParentIdToEmpty.ERROR_MESSAGE,
                    severity: "warning",
                    actions: ["clear"],
                    details: "",
                }],
            });
        }
        return newState;
    }
}
