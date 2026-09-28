package id.saku.money

import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.graphics.Typeface
import android.view.Gravity
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.text.NumberFormat
import java.util.Locale

class QuickEntryActivity : AppCompatActivity() {
    private val spacing by lazy { (12 * resources.displayMetrics.density).toInt() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestWindowFeature(Window.FEATURE_NO_TITLE)
        val mode = intent.getStringExtra(SakuWidgets.EXTRA_MODE) ?: "expense"
        val data = WidgetLedger.load(this)
        if (data == null) { finish(); return }
        val prefs = WidgetLedger.widgetPreferences(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(spacing * 2, spacing * 2, spacing * 2, spacing * 2)
            setBackgroundResource(R.drawable.quick_entry_dialog_background)
            clipToOutline = true
            elevation = spacing.toFloat()
        }
        root.addView(TextView(this).apply {
            text = when (mode) { "income" -> "Quick income"; "transfer" -> "Quick transfer"; else -> "Quick expense" }
            textSize = 21f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(0xff243b38.toInt())
        })
        val amount = field("Amount (Rp)", true).also { root.addView(it) }
        val description = if (mode == "transfer") null else field("Description (optional)").also { root.addView(it) }
        val error = TextView(this).apply { setTextColor(0xffb13e51.toInt()); visibility = TextView.GONE }.also { root.addView(it) }
        val accountIds = data.accounts
        val paymentIds = if (mode == "expense") data.accounts + data.cards.map { it.id } else accountIds
        val paymentLabels = if (mode == "expense") data.accounts + data.cards.map { "Card · ${it.name}" } else accountIds
        val primary = spinner(if (mode == "transfer") "From account" else "Account or card", paymentLabels).also { root.addView(it.first) }.second
        val secondary = if (mode == "transfer") spinner("To account", accountIds).also { root.addView(it.first) }.second else null
        val pocketIds = listOf("") + data.pockets.map { it.id }
        val pocket = if (mode == "expense") spinner("Pocket", listOf("Unassigned") + data.pockets.map { it.name }).also { root.addView(it.first) }.second else null
        select(primary, paymentIds, prefs.getString("lastPayment:${data.userId}:$mode", null))
        if (secondary != null) select(secondary, accountIds, prefs.getString("lastTo:${data.userId}", null) ?: accountIds.getOrNull(1))
        if (pocket != null) select(pocket, pocketIds, prefs.getString("lastPocket:${data.userId}", null))
        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, spacing, 0, 0) }
        actions.addView(Button(this).apply {
            text = "Cancel"; isAllCaps = false; setTextColor(0xff177f72.toInt())
            setBackgroundResource(R.drawable.quick_entry_secondary_button)
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = spacing / 2 })
        actions.addView(Button(this).apply {
            text = "Save"; isAllCaps = false; setTextColor(0xffffffff.toInt())
            setBackgroundResource(R.drawable.quick_entry_primary_button)
            setOnClickListener {
                val value = amount.text.toString().replace(",", "").toLongOrNull()
                if (value == null) { showError(error, "Enter a whole rupiah amount greater than zero"); return@setOnClickListener }
                val result = if (mode == "transfer") WidgetLedger.addTransfer(this@QuickEntryActivity, value, accountIds[primary.selectedItemPosition], accountIds[secondary!!.selectedItemPosition])
                else WidgetLedger.addTransaction(this@QuickEntryActivity, mode, value, description?.text?.toString().orEmpty(), paymentIds[primary.selectedItemPosition], pocket?.let { pocketIds[it.selectedItemPosition] }.orEmpty())
                result.onSuccess {
                    prefs.edit().putString("lastPayment:${data.userId}:$mode", paymentIds[primary.selectedItemPosition])
                        .putString("lastPocket:${data.userId}", pocket?.let { pocketIds[it.selectedItemPosition] }.orEmpty())
                        .putString("lastTo:${data.userId}", secondary?.let { accountIds[it.selectedItemPosition] }).apply()
                    SakuWidgets.refreshAll(this@QuickEntryActivity)
                    finish()
                }.onFailure { showError(error, it.message ?: "Could not save transaction") }
            }
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = spacing / 2 })
        root.addView(actions)
        setContentView(root)
        setFinishOnTouchOutside(true)
        window.setBackgroundDrawableResource(android.R.color.transparent)
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        window.attributes = window.attributes.apply { dimAmount = .24f; gravity = Gravity.CENTER }
        window.setLayout((resources.displayMetrics.widthPixels * .92).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT)
    }

    private fun field(hint: String, amount: Boolean = false) = EditText(this).apply {
        this.hint = hint
        setTextColor(0xff243b38.toInt()); setHintTextColor(0xff71817e.toInt())
        setPadding(spacing, spacing, spacing, spacing)
        if (amount) {
            inputType = InputType.TYPE_CLASS_NUMBER
            addTextChangedListener(object : TextWatcher {
                private var changing = false
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
                override fun afterTextChanged(value: Editable?) {
                    if (changing) return
                    val digits = value.toString().filter(Char::isDigit).take(13)
                    val formatted = digits.toLongOrNull()?.let { NumberFormat.getIntegerInstance(Locale.US).format(it) }.orEmpty()
                    changing = true; setText(formatted); setSelection(formatted.length); changing = false
                }
            })
            requestFocus()
        }
    }
    private fun spinner(label: String, values: List<String>): Pair<LinearLayout, Spinner> {
        val spinner = Spinner(this).apply { adapter = ArrayAdapter(this@QuickEntryActivity, android.R.layout.simple_spinner_dropdown_item, values) }
        return LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, spacing / 2, 0, 0); addView(TextView(this@QuickEntryActivity).apply { text = label; setTextColor(0xff667673.toInt()) }); addView(spinner) } to spinner
    }
    private fun select(spinner: Spinner, values: List<String>, value: String?) { values.indexOf(value).takeIf { it >= 0 }?.let(spinner::setSelection) }
    private fun showError(view: TextView, message: String) { view.text = message; view.visibility = TextView.VISIBLE }
}
