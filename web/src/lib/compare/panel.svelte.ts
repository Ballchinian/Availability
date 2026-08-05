import { errorText } from '../api.js';

/*
    The armed/busy/message triple every panel on the compare page carries:
    whether its form or its "are you sure" step is showing, whether a request is
    out, and the one line of feedback left behind. run() owns the busy flag and
    turns a thrown error into that line, so a panel only says what to call and
    what to say when it worked.
*/
export class Panel {
    open = $state(false);
    busy = $state(false);
    msg = $state('');
    //Whether msg is a complaint rather than a result, so it can be shown in red
    failed = $state(false);

    //Opening drops the last message, so old feedback never sits above a fresh form
    show() {
        this.open = true;
        this.msg = '';
        this.failed = false;
    }

    //Something wrong with the form itself, said without sending anything
    reject(msg: string) {
        this.msg = msg;
        this.failed = true;
    }

    async run(action: () => Promise<string | void>) {
        this.msg = '';
        this.failed = false;
        this.busy = true;
        try {
            const said = await action();
            if (said) this.msg = said;
        } catch (err) {
            this.msg = errorText(err);
            this.failed = true;
        }
        this.busy = false;
    }
}
