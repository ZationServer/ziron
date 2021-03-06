/*
Author: Luca Scaringella
GitHub: LucaCode
Copyright(c) Luca Scaringella
 */

import {Writable} from "./Utils";
import {StreamCloseCode} from "./StreamCloseCode";
import {StreamState} from "./StreamState";
import Transport from "./Transport";
import { DataType } from "./DataType";

export default class ReadStream {

    public readonly state: StreamState = StreamState.Pending;

    private _chainClosed: boolean;
    private _chain: Promise<any>;

    private readonly _createdBadConnectionTimestamp: number;

    private _receiveTimeoutActive: boolean;
    private _receiveTimeout: number;
    private _receiveTimeoutTick: NodeJS.Timeout;

    /**
     * @description
     * The listener that will be called after each chunk that is received.
     */
    public onChunk: (chunk: any, type: DataType) => void | Promise<any> = () => {};
    /**
     * @description
     * The listener will be called when the stream has closed.
     */
    public onClose: (code: StreamCloseCode | number) => void | Promise<any> = () => {};
     /**
     * @description
     * Is called whenever one of the listeners
     * (onChunk, onClose) have thrown an error.
     */
    public onListenerError?: (err: Error) => void;

    private _closedPromiseResolve: () => void;
    public readonly closed: Promise<void> = new Promise(resolve => this._closedPromiseResolve = resolve);

    public readonly closedCode?: StreamCloseCode | number;

    constructor(private readonly id: number, private readonly _transport: Transport) {
        this._createdBadConnectionTimestamp = _transport.badConnectionTimestamp;
    }

    accept(receiveTimeout: number | null = 5000) {
        if(this.state !== StreamState.Pending) return;

        if(this._createdBadConnectionTimestamp !== this._transport.badConnectionTimestamp) {
            //The connection was lost in-between time.
            return this._emitBadConnection();
        }

        //init
        this._chain = Promise.resolve();
        this._chainClosed = false;

        this._transport._addReadStream(this.id,this);
        (this as Writable<ReadStream>).state = StreamState.Open;
        this._transport._sendStreamAccept(this.id);
        if(receiveTimeout != null) this.setReceiveTimeout(receiveTimeout);
    }

    // noinspection JSUnusedGlobalSymbols
    /**
     * @description
     * Will close the stream.
     * Also notifies the WriteStream.
     */
    close(code: StreamCloseCode | number = StreamCloseCode.Abort) {
        if(this._createdBadConnectionTimestamp !== this._transport.badConnectionTimestamp) {
            //The connection was lost in-between time.
            return this._emitBadConnection();
        }
        this._transport._sendReadStreamClose(this.id,code);
        this._close(code);
    }

    // noinspection JSUnusedGlobalSymbols
    /**
     * Sets a timeout that will close the stream with failure when no end or
     * chunk package is received in the given time.
     * @param timeout
     */
    private setReceiveTimeout(timeout: number = 5000) {
        this._receiveTimeout = timeout;
        this._receiveTimeoutTick =
            setTimeout(() => this._close(StreamCloseCode.ReceiveTimeout), timeout);
        this._receiveTimeoutActive = true;
    }

    /**
     * @private
     */
    private _resetReceiveTimeout() {
        clearTimeout(this._receiveTimeoutTick);
        this._receiveTimeoutTick =
            setTimeout(() => this._close(StreamCloseCode.ReceiveTimeout),this._receiveTimeout);
    }

    private _onListenerError(err: Error) {
        if(this.onListenerError) {
            try {this.onListenerError(err)}
            catch(_) {}
        }
    }

    /**
     * @internal
     */
    _addChunkToChain(chunk: Promise<any> | ArrayBuffer, type: DataType) {
        if(this.state === StreamState.Open && !this._chainClosed) {
            if(this._receiveTimeoutActive) this._resetReceiveTimeout();
            this._chain = this._chain.then(() => this._handleChunk(chunk, type));
        }
    }

    private async _handleChunk(chunk: Promise<any> | ArrayBuffer, type: DataType) {
        try {this._newChunk(await chunk,type);}
        catch (e) {
            this._close(StreamCloseCode.InvalidChunk);
            this._transport.onInvalidMessage(e);
        }
    }

    private async _newChunk(chunk: any | ArrayBuffer, type: DataType) {
        if(this.state === StreamState.Open) {
            try {await this.onChunk(chunk,type);}
            catch(err) {this._onListenerError(err);}
        }
    }

    /**
     * @internal
     */
    _addCloseToChain(code: StreamCloseCode | number)  {
        if(this.state === StreamState.Open && !this._chainClosed) {
            this._chainClosed = true;
            if(this._receiveTimeoutActive) clearTimeout(this._receiveTimeoutTick);
            this._chain = this._chain.then(() => this._close(code));
        }
    }

    // noinspection JSUnusedGlobalSymbols
    /**
     * @internal
     */
    _emitBadConnection() {
        this._close(StreamCloseCode.BadConnection,false);
    }

    /**
     * @internal
     */
    _close(code: StreamCloseCode | number, rmFromTransport: boolean = true) {
        if(this.state === StreamState.Closed) return;
        (this as Writable<ReadStream>).state = StreamState.Closed;
        (this as Writable<ReadStream>).closedCode = code;
        this._chainClosed = true;
        if(this._receiveTimeoutActive) clearTimeout(this._receiveTimeoutTick);
        if(rmFromTransport) this._transport._removeReadStream(this.id);
        try {this.onClose(code);}
        catch(err) {this._onListenerError(err)}
        this._closedPromiseResolve();
    }

    /**
     * @internal
     */
    public toJSON() {
        return '[ReadStream]';
    }
}