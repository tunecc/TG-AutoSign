"""
签到任务配置模板 API 路由
独立 router，前缀 /sign-task-templates
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, validator

from backend.core.auth import get_current_user
from backend.services.sign_task_templates import get_sign_task_template_service

router = APIRouter()


class SignTaskTemplateIn(BaseModel):
    """保存模板请求"""

    name: str = Field(..., description="模板名称")
    chats: List[Dict[str, Any]] = Field(default_factory=list, description="Chat 配置列表")
    execution_mode: Optional[str] = Field("fixed", description="执行模式 fixed/range")
    sign_at: Optional[str] = Field("", description="CRON 表达式（fixed 模式）")
    range_start: Optional[str] = Field("", description="随机范围开始时间")
    range_end: Optional[str] = Field("", description="随机范围结束时间")
    random_seconds: Optional[int] = Field(0, description="随机延迟秒数")
    sign_interval: Optional[int] = Field(1, description="签到间隔秒数")

    @validator("name")
    def name_must_be_valid(cls, v):
        import re

        if not v or not v.strip():
            raise ValueError("模板名称不能为空")
        if re.search(r'[<>:"/\\|?*]', v):
            raise ValueError('模板名称不能包含特殊字符: < > : " / \\ | ? *')
        if v.strip() in (".", ".."):
            raise ValueError("模板名称不能为 . 或 ..")
        return v


class SignTaskTemplateOut(BaseModel):
    """模板输出"""

    name: str
    chats: List[Dict[str, Any]]
    execution_mode: str = "fixed"
    sign_at: str = ""
    range_start: str = ""
    range_end: str = ""
    random_seconds: int = 0
    sign_interval: int = 1
    updated_at: Optional[str] = None


@router.get("", response_model=List[SignTaskTemplateOut])
async def list_sign_task_templates(current_user=Depends(get_current_user)):
    """列出全部任务配置模板"""
    return get_sign_task_template_service().list_templates()


@router.post("", response_model=SignTaskTemplateOut, status_code=status.HTTP_201_CREATED)
async def save_sign_task_template(
    payload: SignTaskTemplateIn,
    current_user=Depends(get_current_user),
):
    """保存（覆盖）任务配置模板"""
    try:
        return get_sign_task_template_service().save_template(
            payload.name,
            {
                "chats": payload.chats,
                "execution_mode": payload.execution_mode,
                "sign_at": payload.sign_at,
                "range_start": payload.range_start,
                "range_end": payload.range_end,
                "random_seconds": payload.random_seconds,
                "sign_interval": payload.sign_interval,
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{name}", status_code=status.HTTP_200_OK)
async def delete_sign_task_template(
    name: str,
    current_user=Depends(get_current_user),
):
    """删除任务配置模板"""
    deleted = get_sign_task_template_service().delete_template(name)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"模板 {name} 不存在")
    return {"ok": True}
